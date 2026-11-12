"""Terrain tiles for the landing analysis, derived from NASA/PGDA LOLA south-polar products (Barker et al.).

Sources (all south-polar stereographic, R = 1737400 m, covering the square +-304 km = 80-90 S):
  LDRM_80S_50MPP_ADJ_SLP_100M.TIF    slope (deg) of a plane fit to the LDEM over a 100 m baseline, 50 m/px
  LDRM_80S_50MPP_ADJ_ROUGH_100M.TIF  roughness (m): spread of LOLA spot residuals about that plane, 100 m baseline
  LDEM_80S_20MPP_ADJ.TIF             surface height (m), 20 m/px
  LPSR_80S_20MPP_ADJ.TIF             permanently shadowed region map, 1 = PSR, 20 m/px

Output (same cell grids and tile layout as the hazard tiles, tiers a and b only):
  t/<tier>/<ty>_<tx>.png   R = max 100 m plane-fit slope in the cell, 0.5 deg steps (255 = no data)
                           G = max 100 m roughness in the cell, 0.02 m steps (0..250, saturates at 5 m)
                           B = percent of the cell inside a PSR (0..100)
  e/<tier>/<ty>_<tx>.png   R,G = mean height as 16 bit: (h + 10000 m) / 0.5 m, R high byte
                           B = relief (max - min height inside the cell), 1 m steps, saturates at 250
  terrain.json             geometry, tile lists, encodings, provenance
Cells with fewer than half valid pixels are no data.  Nothing is interpolated.
"""
import json, os, subprocess, sys, time
import numpy as np, rasterio
from rasterio.windows import Window
from PIL import Image

BASE = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
WORK = os.environ.get("WORK", "/mnt/work")
T = 256
HALF_SRC = 304000.0
TIERS = [dict(id="a", half=216400.0, cell=100.0, inner=0.0), dict(id="b", half=304000.0, cell=200.0, inner=216400.0)]
FILES = dict(s16="LDRM_80S_50MPP_ADJ_SLP_1600M.TIF", s08="LDRM_80S_50MPP_ADJ_SLP_800M.TIF", s04="LDRM_80S_50MPP_ADJ_SLP_400M.TIF")

def fetch(name):
    os.makedirs(WORK, exist_ok=True)
    dst = os.path.join(WORK, name)
    if os.path.exists(dst) and os.path.getsize(dst) > 1e6:
        return dst
    for attempt in range(4):
        r = subprocess.run(["aria2c", "-q", "-x", "16", "-s", "16", "-k", "8M", "-c", "--retry-wait=20", "--max-tries=5",
                            "--user-agent=Mozilla/5.0 NYXOS-data-build", "-d", WORK, "-o", name, BASE + name])
        if r.returncode == 0:
            return dst
        time.sleep(20 * (attempt + 1))
    raise SystemExit("download failed: " + name)

def strip_cells(ds, half, cell, ty, k_px):
    """Read the source rows of one tile row and return (cy, cx, k*k) blocks (nan = no data)."""
    res = ds.res[0]
    k = int(round(cell / res))
    assert abs(k * res - cell) < 1e-6, (cell, res)
    off = int(round((HALF_SRC - half) / res))           # pixels between source edge and tier edge
    n = int(round(2 * half / res))
    r0 = off + ty * T * k
    rows = min(T * k, off + n - r0)
    if rows <= 0:
        return None
    a = ds.read(1, window=Window(off, r0, n, rows)).astype("float32")
    cy, cx = rows // k, n // k
    a = a[: cy * k, : cx * k].reshape(cy, k, cx, k).transpose(0, 2, 1, 3).reshape(cy, cx, k * k)
    return a

def main():
    srcs = {k: rasterio.open(fetch(v)) for k, v in FILES.items()}
    manifest = dict(schema=1, source="NASA PGDA, A New View of the Lunar South Pole from LOLA (Barker et al.)", products=FILES,
                    encoding=dict(v=dict(R="plane-fit slope over 1600 m baseline [deg], 0.5/step", G="800 m baseline", B="400 m baseline", nodata="R = 255")),
                    tileCells=T, tiers=[])
    for tr in TIERS:
        cell, half = tr["cell"], tr["half"]
        ncell = int(round(2 * half / cell)); ntile = -(-ncell // T); tiles = []
        os.makedirs(os.path.join(OUT, "v", tr["id"]), exist_ok=True)
        for ty in range(ntile):
            blk = {k: strip_cells(srcs[k], half, cell, ty, None) for k in srcs}
            cy = blk["s16"].shape[0]
            with np.errstate(all="ignore"):
                ok = np.isfinite(blk["s16"]).sum(axis=2) >= blk["s16"].shape[2] // 2
                v = {k: np.nanmean(blk[k], axis=2) for k in blk}
            yc = half - (ty * T + np.arange(cy) + 0.5) * cell
            xc = -half + (np.arange(ncell) + 0.5) * cell
            ok &= ~((np.abs(yc)[:, None] < tr["inner"]) & (np.abs(xc)[None, :] < tr["inner"]))
            for tx in range(ntile):
                sl = (slice(0, T), slice(tx * T, tx * T + T)); o = ok[sl]
                if not o.any(): continue
                h_, w_ = o.shape
                img = np.zeros((T, T, 3), np.uint8); img[..., 0] = 255
                for c, k in enumerate(("s16", "s08", "s04")):
                    img[:h_, :w_, c] = np.where(o, np.clip(np.round(np.nan_to_num(v[k][sl]) * 2), 0, 254), 255 if c == 0 else 0)
                Image.fromarray(img, "RGB").save(os.path.join(OUT, "v", tr["id"], f"{ty}_{tx}.png"), optimize=True)
                tiles.append([ty, tx])
            print(f"tier {tr['id']} row {ty + 1}/{ntile} tiles {len(tiles)}", flush=True)
        manifest["tiers"].append(dict(id=tr["id"], cellM=cell, halfExtentM=half, cells=ncell, tilesPerSide=ntile, tiles=tiles))
    json.dump(manifest, open(os.path.join(OUT, "eva.json"), "w"), separators=(",", ":"))
    print("done", flush=True)

main()
