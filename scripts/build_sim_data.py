"""
Builds the NYXOS mission-simulator assets into public/sim/.

  pole_fine.webp  LOLA LDEM_80S_80M  -> 4096^2 @ 100 m, +-204.8 km (south polar stereographic)
  pole_wide.webp  LOLA LDEM_75S_240M -> 2048^2 @ 400 m, +-409.6 km
  lro_pole.webp   LRO WAC global mosaic (Moon Trek tiles) reprojected, 2048^2 @ 200 m
  sites/<id>_near.webp 1024^2 local tangent-plane grid around each site (20 m polar / 60 m SLDEM2015)
  sites/<id>_mid.webp  1024^2 local grid (120 m polar / 240 m SLDEM2015)
  sites/<id>_photo.jpg 512^2 LRO WAC photo, +-10.24 km around the site
  features.json   IAU/USGS Gazetteer of Planetary Nomenclature (craters, satellite craters, montes, maria)
  earth_*.webp    Earth day / clouds / night maps (Solar System Scope, CC BY 4.0, from NASA data)
  sites.json + manifest.json

Polar maps use this project's convention (scene frame: +Y north pole, +Z = 0E):
  X = 2R * Px / (1 - Py),  Y = 2R * Pz / (1 - Py)   (south polar stereographic, km)
  u = X / (2E) + 0.5, v = Y / (2E) + 0.5, PNG row 0 <-> v = 0.
Local site grids: tangent plane at the site, x east / y north (km), u = x/(2E)+0.5,
  v = 0.5 - y/(2E) (row 0 = north). P = normalize(up + x/R * east + y/R * north).

Every derived product is cross-checked against the global LOLA map before writing.
"""

from __future__ import annotations

import io
import json
import math
import struct
import sys
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_moon_data import (  # noqa: E402
    CACHE,
    LOLA,
    R_KM,
    SLDEM128,
    SLDEM512,
    download,
    get_range,
    read_window,
    write_height_webp,
)

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "sim"
(OUT / "sites").mkdir(parents=True, exist_ok=True)

POLAR = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/{name}.img"
WAC_TILE = "https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{row}/{col}.jpg"
SSS = "https://www.solarsystemscope.com/textures/download/{name}"
NOMEN = "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip"

# id, display name, lat, lon, group
SITES = [
    ("im1", "IM-1 Odysseus", -80.13, 1.44, "CLPS"),
    ("im2", "IM-2 Athena", -84.7906, 29.1957, "CLPS"),
    ("haworth", "Haworth", -86.7, -23.7, "Artemis III region"),
    ("malapert-massif", "Malapert Massif", -86.0, 0.3, "Artemis III region"),
    ("mons-mouton-plateau", "Mons Mouton Plateau", -84.3, 30.6, "Artemis III region"),
    ("nobile-rim-2", "Nobile Rim 2", -83.9, 58.7, "Artemis III region"),
    ("cabeus-b-peak", "Peak near Cabeus B", -83.6, -68.8, "Artemis III region"),
    ("mons-mouton", "Mons Mouton (site MMO01)", -85.416, 31.8506, "Candidate site"),
    ("nobile-rim-1", "Nobile Rim 1 (site NR101)", -85.295, 36.9168, "Candidate site"),
    ("de-gerlache-rim-2", "de Gerlache Rim 2 (site dGR2_K2023)", -88.45, -67.8591, "Candidate site"),
    ("slater-plain", "Slater Plain (site SP07)", -87.1306, 127.857, "Candidate site"),
    ("shackleton", "Shackleton crater", -89.67, 129.78, "Landmark"),
    ("connecting-ridge-cr1", "Connecting Ridge CR1", -89.45, -137.31, "Candidate site"),
    ("shackleton-rim-s", "Shackleton rim S", -89.78, -155.73, "Candidate site"),
    ("south-pole", "Lunar south pole", -90.0, 0.0, "Landmark"),
    ("apollo-11", "Apollo 11 · Tranquility Base", 0.674, 23.473, "Apollo"),
    ("apollo-12", "Apollo 12 · Ocean of Storms", -3.014, -23.419, "Apollo"),
    ("apollo-14", "Apollo 14 · Fra Mauro", -3.646, -17.472, "Apollo"),
    ("apollo-15", "Apollo 15 · Hadley Rille", 26.132, 3.633, "Apollo"),
    ("apollo-16", "Apollo 16 · Descartes", -8.973, 15.499, "Apollo"),
    ("apollo-17", "Apollo 17 · Taurus–Littrow", 20.191, 30.772, "Apollo"),
]

DEG = math.pi / 180

# ------------------------------------------------------------- geometry --


def latlon_to_dir(lat_deg, lon_deg):
    la, lo = np.asarray(lat_deg) * DEG, np.asarray(lon_deg) * DEG
    return np.stack([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)], axis=-1)


def dir_to_latlon(p):
    p = p / np.linalg.norm(p, axis=-1, keepdims=True)
    return np.arcsin(np.clip(p[..., 1], -1, 1)) / DEG, np.arctan2(p[..., 0], p[..., 2]) / DEG


def stereo_from_dir(p):
    p = p / np.linalg.norm(p, axis=-1, keepdims=True)
    d = 1 - p[..., 1]
    return 2 * R_KM * p[..., 0] / d, 2 * R_KM * p[..., 2] / d


def dir_from_stereo(X, Y):
    """Inverse south-polar stereographic -> unit direction (scene frame)."""
    rho = np.hypot(X, Y)
    lat = 2 * np.arctan(rho / (2 * R_KM)) - math.pi / 2
    lon = np.arctan2(X, Y)
    return np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)], axis=-1)


def site_frame(lat, lon):
    la, lo = lat * DEG, lon * DEG
    up = np.array([math.cos(la) * math.sin(lo), math.sin(la), math.cos(la) * math.cos(lo)])
    east = np.array([math.cos(lo), 0.0, -math.sin(lo)])
    north = np.array([-math.sin(la) * math.sin(lo), math.cos(la), -math.sin(la) * math.cos(lo)])
    return up, east, north


def local_grid_dirs(lat, lon, n, cell_km):
    """Directions for a north-up local tangent-plane grid (row 0 = north)."""
    up, east, north = site_frame(lat, lon)
    half = n * cell_km / 2
    c = (np.arange(n) + 0.5) * cell_km - half
    x = c[None, :]
    y = -c[:, None]  # row 0 is north
    p = up[None, None, :] + (x[..., None] * east + y[..., None] * north) / R_KM
    return p / np.linalg.norm(p, axis=-1, keepdims=True)


# -------------------------------------------------- PDS polar stereographic --

POLAR_SPECS = {
    # name: (lines, scale_km, offset_px)
    "ldem_75s_240m": (3812, 0.240, 1905.5),
    "ldem_80s_80m": (7600, 0.080, 3799.5),
    "ldem_80s_20m": (30400, 0.020, 15199.5),
    "ldem_75s_30m": (30496, 0.030, 15247.5),
    "ldem_75s_120m": (7624, 0.120, 3811.5),
}

# The PDS labels give scale/offset but not axis orientation; ORIENT maps this
# project's (X, Y) to the product's (x along samples, y along lines). It is
# chosen empirically by correlating against the global LOLA map.
ORIENT_CANDIDATES = [(sx, sy, swap) for sx in (1, -1) for sy in (1, -1) for swap in (False, True)]
ORIENT = None


def to_pds_px(X, Y, name, orient):
    n, scale, off = POLAR_SPECS[name]
    sx, sy, swap = orient
    a, b = (Y, X) if swap else (X, Y)
    col = sx * a / scale + off
    row = sy * b / scale + off
    return row, col


def polar_window(name, rows, cols, tag):
    n = POLAR_SPECS[name][0]
    r0, r1 = max(0, rows[0]), min(n, rows[1])
    c0, c1 = max(0, cols[0]), min(n, cols[1])
    arr = read_window(POLAR.format(name=name), n * 2, 2, "<i2", range(r0, r1), [(c0, c1 - c0)], tag)
    return arr.astype(np.float32) * 0.0005, r0, c0


def sample_polar(name, dirs, orient, tag, margin=6):
    """Bilinear-sample a PDS polar DEM (km) at unit directions, fetching only the needed window."""
    X, Y = stereo_from_dir(dirs)
    row, col = to_pds_px(X, Y, name, orient)
    rows = (int(np.floor(row.min())) - margin, int(np.ceil(row.max())) + margin)
    cols = (int(np.floor(col.min())) - margin, int(np.ceil(col.max())) + margin)
    win, r0, c0 = polar_window(name, rows, cols, tag)
    return ndimage.map_coordinates(win, [row - r0, col - c0], order=1, mode="nearest")


# ---------------------------------------------------------- global LOLA --


def global_lola():
    path = download(LOLA.format(name="ldem_16"), "ldem_16.img")
    return np.fromfile(path, dtype="<i2").reshape(2880, 5760).astype(np.float32) * 0.0005


def sample_global(g, lat, lon):
    row = (90 - lat) * 16 - 0.5
    col = (np.mod(lon, 360)) * 16 - 0.5
    gw = np.hstack([g, g[:, :2]])
    return ndimage.map_coordinates(gw, [row, col], order=1, mode="nearest")


def check(name, a, b, min_corr=0.97):
    d = a - b
    corr = np.corrcoef(a.ravel(), b.ravel())[0, 1]
    print(f"  check {name}: mean {d.mean() * 1000:7.1f} m  rms {d.std() * 1000:7.1f} m  corr {corr:.4f}")
    if corr < min_corr:
        sys.exit(f"  !! {name} disagrees with global LOLA (corr {corr:.3f})")


def find_orientation(g):
    """Pick the axis convention for PDS polar products using LDEM_75S_240M."""
    global ORIENT
    path = download(POLAR.format(name="ldem_75s_240m"), "ldem_75s_240m.img")
    full = np.fromfile(path, dtype="<i2").reshape(3812, 3812).astype(np.float32) * 0.0005
    rng = np.random.default_rng(3)
    lat = rng.uniform(-88.5, -77.0, 6000)
    lon = rng.uniform(-180, 180, 6000)
    ref = sample_global(g, lat, lon)
    X, Y = stereo_from_dir(latlon_to_dir(lat, lon))
    best = None
    for o in ORIENT_CANDIDATES:
        row, col = to_pds_px(X, Y, "ldem_75s_240m", o)
        v = ndimage.map_coordinates(full, [row, col], order=1, mode="nearest")
        c = np.corrcoef(v, ref)[0, 1]
        if best is None or c > best[0]:
            best = (c, o)
    print(f"  polar orientation {best[1]}  corr {best[0]:.4f}")
    if best[0] < 0.97:
        sys.exit("  !! could not determine polar orientation")
    ORIENT = best[1]
    return full


# ---------------------------------------------------------- polar levels --


def polar_level(name, n, cell_km, tag, g, src_full=None):
    half = n * cell_km / 2
    c = (np.arange(n) + 0.5) * cell_km - half
    X = np.broadcast_to(c[None, :], (n, n))
    Y = np.broadcast_to(c[:, None], (n, n))  # row index grows with Y (v = Y/2E + 0.5)
    row, col = to_pds_px(X, Y, name, ORIENT)
    src_cell = POLAR_SPECS[name][1]
    sigma = max(0.0, 0.5 * (cell_km / src_cell - 1))
    if src_full is not None:
        win, r0, c0 = src_full, 0, 0
    else:
        win, r0, c0 = polar_window(
            name, (int(row.min()) - 8, int(row.max()) + 8), (int(col.min()) - 8, int(col.max()) + 8), tag
        )
    if sigma > 0:
        win = ndimage.gaussian_filter(win, sigma)
    out = ndimage.map_coordinates(win, [row - r0, col - c0], order=1, mode="nearest").astype(np.float32)
    # verify against global LOLA on a coarse lattice
    k = slice(0, n, max(1, n // 96))
    lat, lon = dir_to_latlon(dir_from_stereo(X[k, k], Y[k, k]))
    check(tag, out[k, k], sample_global(g, lat, lon), 0.95)
    return out


# ------------------------------------------------------------ SLDEM2015 --


def sldem512_sample(lat, lon, tag):
    """Bilinear-sample SLDEM2015 512 ppd (km) across tiles, fetching only needed windows."""
    lon360 = np.mod(lon, 360)
    out = np.full(lat.shape, np.nan, dtype=np.float32)
    bands = [(30, 60, "30N_60N"), (0, 30, "00N_30N"), (-30, 0, "30S_00S"), (-60, -30, "60S_30S")]
    for la0, la1, lname in bands:
        for lo0 in range(0, 360, 45):
            m = (lat >= la0) & (lat < la1) & (lon360 >= lo0) & (lon360 < lo0 + 45)
            if not m.any():
                continue
            # pad one pixel each side, clamped to tile
            rows_f = (la1 - lat[m]) * 512 - 0.5
            cols_f = (lon360[m] - lo0) * 512 - 0.5
            r0 = max(0, int(rows_f.min()) - 2)
            r1 = min(15360, int(rows_f.max()) + 3)
            c0 = max(0, int(cols_f.min()) - 2)
            c1 = min(23040, int(cols_f.max()) + 3)
            name = f"{lname}_{lo0:03d}_{lo0 + 45:03d}"
            win = read_window(SLDEM512.format(tile=name), 23040 * 4, 4, "<f4",
                              range(r0, r1), [(c0, c1 - c0)], f"{tag}_{name}_{r0}_{c0}")
            out[m] = ndimage.map_coordinates(win.astype(np.float32), [rows_f - r0, cols_f - c0], order=1, mode="nearest")
    if np.isnan(out).any():
        sys.exit(f"  !! {tag}: SLDEM coverage gap")
    return out


def sldem128_sample(lat, lon, tag):
    lon360 = np.mod(lon, 360)
    rows_f = (60 - lat) * 128 - 0.5
    cols_f = lon360 * 128 - 0.5
    # handle wrap by unwrapping around the median longitude
    med = np.median(cols_f)
    cols_f = np.where(cols_f - med > 23040, cols_f - 46080, cols_f)
    cols_f = np.where(med - cols_f > 23040, cols_f + 46080, cols_f)
    r0, r1 = int(rows_f.min()) - 2, int(rows_f.max()) + 3
    c0, c1 = int(cols_f.min()) - 2, int(cols_f.max()) + 3
    segs = []
    c = c0
    while c < c1:
        cc = c % 46080
        n = min(c1 - c, 46080 - cc)
        segs.append((cc, n))
        c += n
    win = read_window(SLDEM128, 46080 * 4, 4, "<f4", range(r0, r1), segs, f"{tag}_{r0}_{c0}")
    return ndimage.map_coordinates(win.astype(np.float32), [rows_f - r0, cols_f - c0], order=1, mode="nearest")


# ----------------------------------------------------------- LRO WAC tiles --

_tile_lock = threading.Lock()


def wac_tile(z, row, col):
    path = CACHE / "wac" / f"{z}_{row}_{col}.jpg"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(6):
            try:
                r = requests.get(WAC_TILE.format(z=z, row=row, col=col), timeout=60)
                if r.status_code == 200:
                    path.write_bytes(r.content)
                    break
            except requests.RequestException:
                pass
            time.sleep(1 + attempt * 2)
        else:
            raise RuntimeError(f"WAC tile {z}/{row}/{col} failed")
    return np.asarray(Image.open(path).convert("L"), dtype=np.float32)


def wac_sample(lat, lon, z):
    """Sample the LRO WAC global mosaic (Moon Trek equirectangular tiles) at lat/lon."""
    deg_per_px = (180 / 2**z) / 256
    py = (90 - lat) / deg_per_px - 0.5
    px = (np.mod(lon + 180, 360)) / deg_per_px - 0.5
    ncols_px = 2 ** (z + 1) * 256
    trow = np.unique(np.clip((py // 256).astype(int), 0, 2**z - 1))
    tcol = np.unique(np.clip((px // 256).astype(int), 0, 2 ** (z + 1) - 1))
    need = [(r, c) for r in range(trow.min(), trow.max() + 1) for c in tcol]
    with ThreadPoolExecutor(24) as ex:
        tiles = dict(zip(need, ex.map(lambda rc: wac_tile(z, *rc), need)))
    r0 = trow.min()
    rows = trow.max() - r0 + 1
    band = np.zeros((rows * 256, ncols_px + 1), dtype=np.float32)
    for (r, c), t in tiles.items():
        band[(r - r0) * 256:(r - r0 + 1) * 256, c * 256:(c + 1) * 256] = t
    band[:, -1] = band[:, 0]
    return ndimage.map_coordinates(band, [py - r0 * 256, px], order=1, mode="nearest")


# ---------------------------------------------------------------- export --


def save_height(arr_km, path: Path, quantum_m):
    lo = float(arr_km.min())
    q = np.round((arr_km - lo) / (quantum_m / 1000))
    if q.max() > 65535:
        sys.exit(f"  !! {path.name}: range too large for {quantum_m} m steps")
    write_height_webp(q, path)
    print(f"  wrote {path.relative_to(OUT)}  {arr_km.shape[1]}x{arr_km.shape[0]}  {path.stat().st_size / 1e6:.2f} MB")
    return {"file": str(path.relative_to(OUT)).replace("\\", "/"), "size": arr_km.shape[0],
            "hMin": lo, "hMax": lo + 65535 * quantum_m / 1000}


def build_features():
    zpath = download(NOMEN, "MOON_nomenclature_center_pts.zip")
    with zipfile.ZipFile(zpath) as z:
        dbf_name = next(n for n in z.namelist() if n.lower().endswith(".dbf"))
        data = z.read(dbf_name)
    nrec, hlen, rlen = struct.unpack("<IHH", data[4:12])
    fields = []
    off = 32
    while data[off] != 0x0D:
        name = data[off:off + 11].split(b"\x00")[0].decode()
        ftype = chr(data[off + 11])
        flen = data[off + 16]
        fields.append((name, ftype, flen))
        off += 32
    print("  nomenclature fields:", [f[0] for f in fields])
    recs = []
    for i in range(nrec):
        base = hlen + i * rlen + 1
        rec = {}
        p = base
        for name, ftype, flen in fields:
            raw = data[p:p + flen]
            p += flen
            rec[name] = raw.decode("utf-8", errors="replace").strip()
        recs.append(rec)

    def pick(rec, *keys):
        for k in keys:
            for kk in rec:
                if kk.lower() == k:
                    return rec[kk]
        return ""

    keep = {"crater, craters": "crater", "satellite feature": "satellite", "mons, montes": "mons",
            "mare, maria": "mare", "vallis, valles": "vallis"}
    out = []
    for r in recs:
        ftype = pick(r, "type").lower()
        kind = keep.get(ftype)
        if not kind:
            continue
        if pick(r, "approval").lower() not in ("", "adopted by iau", "approved"):
            if "drop" in pick(r, "approval").lower():
                continue
        try:
            lat = float(pick(r, "center_lat"))
            lon = float(pick(r, "center_lon"))
            diam = float(pick(r, "diameter") or 0)
        except ValueError:
            continue
        if lon > 180:
            lon -= 360
        name = pick(r, "clean_name", "name")
        if not name:
            continue
        out.append([name, round(lat, 4), round(lon, 4), round(diam, 2), kind])
    out.sort(key=lambda f: -f[3])
    (OUT / "features.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kinds = {}
    for f in out:
        kinds[f[4]] = kinds.get(f[4], 0) + 1
    print(f"  wrote features.json  {len(out)} features {kinds}  {(OUT / 'features.json').stat().st_size / 1e6:.2f} MB")


def build_earth():
    out = {}
    for key, name, size in (("day", "8k_earth_daymap.jpg", (4096, 2048)),
                            ("clouds", "8k_earth_clouds.jpg", (4096, 2048)),
                            ("night", "2k_earth_nightmap.jpg", (2048, 1024))):
        src = download(SSS.format(name=name), name)
        img = Image.open(src).convert("RGB" if key != "clouds" else "L").resize(size, Image.LANCZOS)
        p = OUT / f"earth_{key}.webp"
        img.save(p, quality=86, method=6)
        out[key] = p.name
        print(f"  wrote {p.name}  {p.stat().st_size / 1e6:.2f} MB")
    return out


def main():
    t0 = time.time()
    g = global_lola()

    print("[1/6] polar orientation + wide level (LDEM_75S_240M)")
    full240 = find_orientation(g)
    wide = polar_level("ldem_75s_240m", 2048, 0.400, "pole_wide", g, src_full=full240)

    print("[2/6] polar fine level (LDEM_80S_80M)")
    fine = polar_level("ldem_80s_80m", 4096, 0.100, "pole_fine", g)
    # fine vs wide agreement
    k = slice(1024, 3072, 16)
    c = (np.arange(4096) + 0.5) * 0.1 - 204.8
    Xs, Ys = np.meshgrid(c[k], c[k])
    wv = ndimage.map_coordinates(wide, [(Ys + 409.6) / 0.4 - 0.5, (Xs + 409.6) / 0.4 - 0.5], order=1)
    check("pole_fine vs pole_wide", fine[k, k], wv, 0.99)

    print("[3/6] LRO WAC polar photo")
    n = 2048
    cc = (np.arange(n) + 0.5) * 0.2 - 204.8
    X, Y = np.meshgrid(cc, cc)
    lat, lon = dir_to_latlon(dir_from_stereo(X, Y))
    photo = wac_sample(lat, lon, 7)
    Image.fromarray(np.clip(photo, 0, 255).astype(np.uint8)).save(OUT / "lro_pole.webp", quality=84, method=6)
    print(f"  wrote lro_pole.webp  {(OUT / 'lro_pole.webp').stat().st_size / 1e6:.2f} MB")

    print("[4/6] site patches")
    sites_out = []
    for sid, name, lat, lon, group in SITES:
        polar = lat < -60
        entry = {"id": sid, "name": name, "lat": lat, "lon": lon, "group": group}
        X0, Y0 = stereo_from_dir(latlon_to_dir(lat, lon))
        rho = float(np.hypot(X0, Y0))
        if polar:
            near_src = "ldem_80s_20m" if rho + 12 < 300 else "ldem_75s_30m"
            near = sample_polar(near_src, local_grid_dirs(lat, lon, 1024, 0.020), ORIENT, f"near_{sid}")
            mid = sample_polar("ldem_75s_120m", local_grid_dirs(lat, lon, 1024, 0.120), ORIENT, f"mid_{sid}")
            near_cell, mid_cell = 0.020, 0.120
            entry["source"] = f"LOLA {near_src.upper()} / LDEM_75S_120M"
        else:
            dn = local_grid_dirs(lat, lon, 1024, 0.060)
            near = sldem512_sample(*dir_to_latlon(dn), f"near_{sid}")
            dm = local_grid_dirs(lat, lon, 1024, 0.240)
            mid = sldem128_sample(*dir_to_latlon(dm), f"mid_{sid}")
            near_cell, mid_cell = 0.060, 0.240
            entry["source"] = "SLDEM2015 512 / 128 ppd"
        # verify each patch against global LOLA
        dm_chk = local_grid_dirs(lat, lon, 64, mid_cell * 16)
        mla, mlo = dir_to_latlon(dm_chk)
        mid_c = ndimage.zoom(mid, 64 / 1024, order=1)
        check(f"{sid} mid", mid_c, sample_global(g, mla, mlo), 0.9)
        nb = ndimage.zoom(near, 1 / 16, order=1)
        mv = ndimage.map_coordinates(mid, [np.linspace(512 - 512 * near_cell / mid_cell, 512 + 512 * near_cell / mid_cell, 64)[:, None] * np.ones((1, 64)) - 0.5,
                                           np.ones((64, 1)) * np.linspace(512 - 512 * near_cell / mid_cell, 512 + 512 * near_cell / mid_cell, 64)[None, :] - 0.5], order=1)
        check(f"{sid} near vs mid", nb, mv, 0.9)
        entry["near"] = {**save_height(near, OUT / "sites" / f"{sid}_near.webp", 0.1), "cellKm": near_cell}
        entry["mid"] = {**save_height(mid, OUT / "sites" / f"{sid}_mid.webp", 0.5), "cellKm": mid_cell}
        # orbital photo crop
        pd = local_grid_dirs(lat, lon, 512, 0.040)
        pla, plo = dir_to_latlon(pd)
        ph = wac_sample(pla, plo, 8 if not polar else 7)
        Image.fromarray(np.clip(ph, 0, 255).astype(np.uint8)).save(OUT / "sites" / f"{sid}_photo.jpg", quality=86)
        entry["photo"] = f"sites/{sid}_photo.jpg"
        sites_out.append(entry)
    (OUT / "sites.json").write_text(json.dumps(sites_out, ensure_ascii=False, indent=1), encoding="utf-8")

    print("[5/6] features + earth")
    build_features()
    earth = build_earth()

    print("[6/6] polar heights -> PNG")
    manifest = {
        "radiusKm": R_KM,
        "poleFine": {**save_height(fine, OUT / "pole_fine.webp", 0.25), "cellKm": 0.1, "halfExtentKm": 204.8,
                     "source": "LRO LOLA LDEM_80S_80M"},
        "poleWide": {**save_height(wide, OUT / "pole_wide.webp", 1.0), "cellKm": 0.4, "halfExtentKm": 409.6,
                     "source": "LRO LOLA LDEM_75S_240M"},
        "lroPole": {"file": "lro_pole.webp", "cellKm": 0.2, "halfExtentKm": 204.8,
                    "source": "LRO WAC global mosaic v2 (NASA/GSFC/ASU) via NASA Moon Trek"},
        "earth": earth,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file()) / 1e6
    print(f"done in {time.time() - t0:.0f}s - public/sim total {total:.1f} MB")


if __name__ == "__main__":
    main()
