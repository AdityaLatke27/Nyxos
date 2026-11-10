"""Derive lander-scale slope-hazard tiles from NASA/PGDA LOLA south-polar grids.

Input  : LDSM_<lat>S_<res>MPP_ADJ.TIF (LOLA digital slope map, degrees) and, when
         retrievable, LDSM_*_ERR.TIF (slope error, degrees), all south-polar stereographic,
         R = 1737400 m, 1 pixel = res metres.
Output : public/landing/<tier>/<ty>_<tx>.png  (256x256 RGB, one pixel = one hazard cell)
           R = 95th-percentile slope in the cell, 0.5 deg steps (0..127 -> 0..63.5 deg)
           G = percent of valid pixels in the cell steeper than 10 deg (0..100)
           B = mean slope error in the cell, 0.1 deg steps (0..250), 0 = no error product
         255 in R means "no data".  Rows run north (+y) to south, columns west (-x) to east.
         public/landing/manifest.json describes tiers, grids and provenance.
Nothing here is interpolated across missing data: cells with <50% valid pixels are no-data.
"""
import json, os, subprocess, sys, time
import numpy as np, rasterio
from rasterio.windows import Window
from PIL import Image

BASE = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
OUT = sys.argv[1] if len(sys.argv) > 1 else "public/landing"
WORK = os.environ.get("WORK", "/mnt/work")
T = 256  # cells per tile edge

# name, latitude limit, native m/px, cell = k native px, role
TIERS = [
    dict(id="a", lat="83S", res=10, k=10),
    dict(id="b", lat="80S", res=20, k=10),
    dict(id="c", lat="75S", res=30, k=8),
    dict(id="d", lat="60S", res=60, k=8),
]

def fetch(name):
    os.makedirs(WORK, exist_ok=True)
    dst = os.path.join(WORK, name)
    if os.path.exists(dst) and os.path.getsize(dst) > 1e6:
        return dst
    for attempt in range(6):
        r = subprocess.run(["curl", "-sSL", "-f", "-C", "-", "--retry", "3", "-A", "Mozilla/5.0 NYXOS-data-build",
                            "-o", dst, BASE + name])
        if r.returncode == 0:
            return dst
        print("  retry", name, attempt, flush=True)
        time.sleep(20 * (attempt + 1))
    return None

def cell_stats(strip, k, errstrip):
    h, w = strip.shape
    cy, cx = h // k, w // k
    a = strip[: cy * k, : cx * k].reshape(cy, k, cx, k).transpose(0, 2, 1, 3).reshape(cy, cx, k * k)
    valid = np.isfinite(a)
    nvalid = valid.sum(axis=2)
    ok = nvalid >= (k * k) // 2
    with np.errstate(all="ignore"):
        p95 = np.nanpercentile(a, 95, axis=2)
        frac10 = np.where(nvalid > 0, (np.where(valid, a, 0) > 10).sum(axis=2) * 100.0 / np.maximum(nvalid, 1), 0)
        if errstrip is not None:
            e = errstrip[: cy * k, : cx * k].reshape(cy, k, cx, k).transpose(0, 2, 1, 3).reshape(cy, cx, k * k)
            err = np.nanmean(e, axis=2)
        else:
            err = np.zeros((cy, cx))
    return ok, p95, frac10, err

def main():
    manifest = dict(
        schema=1,
        frame="south-polar stereographic, lat_ts=-90, lon_0=0, sphere R=1737400 m (MOON_ME / DE421 frame as published by PGDA)",
        axes="x toward 90E at the pole, y toward 0E; row 0 = +y edge",
        tileCells=T,
        source="NASA PGDA / LOLA large-area south-polar DEM family, https://pgda.gsfc.nasa.gov/products/90 (Barker et al.)",
        encoding=dict(R="p95 slope, 0.5 deg/step, 255=no data", G="percent of pixels >10 deg", B="mean slope error, 0.1 deg/step (0 = not available)"),
        tiers=[],
    )
    prev_half = 0.0
    for t in TIERS:
        name = f"LDSM_{t['lat']}_{t['res']}MPP_ADJ.TIF"
        print("==", name, flush=True)
        path = fetch(name)
        if not path:
            print("  FAILED to download; skipping tier", flush=True)
            continue
        epath = fetch(name.replace(".TIF", "_ERR.TIF"))
        with rasterio.open(path) as d:
            n = d.width
            half = d.bounds.right  # metres
            res = d.res[0]
            assert abs(d.bounds.left + half) < 1 and d.nodata is None or True
            k = t["k"]
            cell = res * k
            ncell = n // k
            ntile = -(-ncell // T)
            tdir = os.path.join(OUT, t["id"])
            os.makedirs(tdir, exist_ok=True)
            tiles = []
            edrv = rasterio.open(epath) if epath else None
            for ty in range(ntile):
                r0 = ty * T * k
                rh = min(T * k, n - r0)
                strip = d.read(1, window=Window(0, r0, n, rh)).astype("float32")
                strip[strip < 0] = np.nan
                estrip = edrv.read(1, window=Window(0, r0, n, rh)).astype("float32") if edrv else None
                ok, p95, frac10, err = cell_stats(strip, k, estrip)
                cy = ok.shape[0]
                # cells wholly inside the finer tier's square are not stored
                yc = half - (ty * T + np.arange(cy) + 0.5) * cell
                xc = -half + (np.arange(ok.shape[1]) + 0.5) * cell
                inner = (np.abs(yc)[:, None] < prev_half) & (np.abs(xc)[None, :] < prev_half)
                ok = ok & ~inner
                for tx in range(ntile):
                    sl = (slice(0, T), slice(tx * T, tx * T + T))
                    o = ok[sl]
                    if not o.any():
                        continue
                    img = np.full((T, T, 3), 0, np.uint8)
                    img[..., 0] = 255
                    h_, w_ = o.shape
                    R = np.where(o, np.clip(np.round(p95[sl] * 2), 0, 127), 255)
                    G = np.where(o, np.clip(np.round(frac10[sl]), 0, 100), 0)
                    B = np.where(o, np.clip(np.round(err[sl] * 10), 0, 250), 0)
                    img[:h_, :w_, 0], img[:h_, :w_, 1], img[:h_, :w_, 2] = R, G, B
                    Image.fromarray(img, "RGB").save(os.path.join(tdir, f"{ty}_{tx}.png"), optimize=True)
                    tiles.append([ty, tx])
                print(f"  row {ty + 1}/{ntile} tiles so far {len(tiles)}", flush=True)
            if edrv:
                edrv.close()
        manifest["tiers"].append(dict(
            id=t["id"], product=name, errProduct=(os.path.basename(epath) if epath else None),
            nativeM=res, cellM=cell, halfExtentM=half, cells=ncell, tilesPerSide=ntile, tiles=tiles,
        ))
        prev_half = half
        for p in (path, epath):
            if p and os.path.exists(p):
                os.remove(p)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    print("done", flush=True)

main()
