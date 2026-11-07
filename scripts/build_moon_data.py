"""
Builds NYXOS moon assets from NASA public-domain data into public/moon/.

Elevation pyramid centered on the near-side center (0°N, 0°E, Sinus Medii):
  l0      SLDEM2015 (LOLA + SELENE/Kaguya)  512 px/deg   ~59 m/px   6° x 6°
  l1      SLDEM2015                         128 px/deg  ~237 m/px  16° x 16°
  l2      LRO LOLA LDEM_64 (2x2 averaged)    32 px/deg  ~948 m/px  64° x 64°
  global  LRO LOLA LDEM_16 resampled       ~11.4 px/deg ~2.67 km/px whole moon
Only the needed windows are fetched, via HTTP range requests.

Color: NASA SVS CGI Moon Kit (LROC WAC color, poles filled).
Stars: NASA SVS Deep Star Maps 2020 (Hipparcos-2, Tycho-2, Gaia DR2), ICRF.

All heights are km above the 1737.4 km reference sphere. Every output map is
re-ordered so that column 0 = west edge and row 0 = north edge.

Usage:  python scripts/build_moon_data.py
"""

from __future__ import annotations

import json
import math
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache"
OUT = ROOT / "public" / "moon"
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

R_KM = 1737.4

SLDEM512 = "http://imbrium.mit.edu/DATA/SLDEM2015/TILES/FLOAT_IMG/SLDEM2015_512_{tile}_FLOAT.IMG"
SLDEM128 = "http://imbrium.mit.edu/DATA/SLDEM2015/GLOBAL/FLOAT_IMG/SLDEM2015_128_60S_60N_000_360_FLOAT.IMG"
LOLA = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/{name}.img"
SVS_MOON = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/{name}"
SVS_STARS = "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/{name}"

# ---------------------------------------------------------------- download --

_local = threading.local()


def _session() -> requests.Session:
    if not hasattr(_local, "s"):
        s = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=2, pool_maxsize=2)
        s.mount("http://", adapter)
        s.mount("https://", adapter)
        _local.s = s
    return _local.s


def get_range(url: str, start: int, length: int) -> bytes:
    for attempt in range(6):
        try:
            r = _session().get(
                url, headers={"Range": f"bytes={start}-{start + length - 1}"}, timeout=60
            )
            if r.status_code == 206 and len(r.content) == length:
                return r.content
        except requests.RequestException:
            pass
        time.sleep(1 + attempt * 2)
    raise RuntimeError(f"range fetch failed: {url} @ {start}+{length}")


def read_window(url, record_bytes, sample_bytes, dtype, rows, col_segments, cache_name):
    """Fetch rows x (concatenated column segments) from a raw row-major image."""
    cache = CACHE / f"{cache_name}.npy"
    if cache.exists():
        return np.load(cache)
    rows = list(rows)
    ncols = sum(n for _, n in col_segments)
    out = np.empty((len(rows), ncols), dtype=dtype)
    jobs = []
    for i, r in enumerate(rows):
        c0 = 0
        for cs, n in col_segments:
            jobs.append((i, c0, r * record_bytes + cs * sample_bytes, n * sample_bytes, n))
            c0 += n
    lock = threading.Lock()
    done = [0]

    def work(job):
        i, c0, off, length, n = job
        out[i, c0 : c0 + n] = np.frombuffer(get_range(url, off, length), dtype=dtype)
        with lock:
            done[0] += 1
            if done[0] % 500 == 0 or done[0] == len(jobs):
                print(f"    {cache_name}: {done[0]}/{len(jobs)} ranges", flush=True)

    with ThreadPoolExecutor(32) as ex:
        list(ex.map(work, jobs))
    np.save(cache, out)
    return out


def download(url: str, name: str) -> Path:
    path = CACHE / name
    if path.exists():
        return path
    print(f"  downloading {name} ...", flush=True)
    tmp = path.with_suffix(path.suffix + ".part")
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        got = 0
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                got += len(chunk)
                if total and got % (16 << 20) < (1 << 20):
                    print(f"    {name}: {got / total:5.1%}", flush=True)
    tmp.rename(path)
    return path


# ----------------------------------------------------------------- levels --


def build_l0() -> np.ndarray:
    """SLDEM2015 512 ppd, lat/lon -3..+3 — straddles four tiles at the 0/0 corner."""
    ppd, half = 512, 3 * 512
    rec = 23040 * 4
    north_rows = range(15360 - half, 15360)  # tile 00N_30N: lat 3 -> 0
    south_rows = range(0, half)  # tile 30S_00S: lat 0 -> -3
    west = [(23040 - half, half)]  # tile 315_360: lon 357 -> 360
    east = [(0, half)]  # tile 000_045: lon 0 -> 3

    def tile(t):
        return SLDEM512.format(tile=t)

    nw = read_window(tile("00N_30N_315_360"), rec, 4, "<f4", north_rows, west, "l0_nw")
    ne = read_window(tile("00N_30N_000_045"), rec, 4, "<f4", north_rows, east, "l0_ne")
    sw = read_window(tile("30S_00S_315_360"), rec, 4, "<f4", south_rows, west, "l0_sw")
    se = read_window(tile("30S_00S_000_045"), rec, 4, "<f4", south_rows, east, "l0_se")
    return np.vstack([np.hstack([nw, ne]), np.hstack([sw, se])]).astype(np.float32)


def build_l1() -> np.ndarray:
    """SLDEM2015 128 ppd global, lat/lon -8..+8."""
    half = 8 * 128
    rows = range((60 - 8) * 128, (60 + 8) * 128)
    segs = [(46080 - half, half), (0, half)]
    return read_window(SLDEM128, 46080 * 4, 4, "<f4", rows, segs, "l1").astype(np.float32)


def build_l2() -> np.ndarray:
    """LOLA LDEM_64 (int16, 0.5 m), lat/lon -32..+32, averaged 2x2 to 32 ppd."""
    half = 32 * 64
    rows = range((90 - 32) * 64, (90 + 32) * 64)
    segs = [(23040 - half, half), (0, half)]
    raw = read_window(LOLA.format(name="ldem_64"), 23040 * 2, 2, "<i2", rows, segs, "l2")
    km = raw.astype(np.float32) * 0.0005
    h, w = km.shape
    return km.reshape(h // 2, 2, w // 2, 2).mean(axis=(1, 3))


def build_global() -> np.ndarray:
    """LOLA LDEM_16 (5760 x 2880) resampled to 4096 x 2048, col 0 = lon 0."""
    path = download(LOLA.format(name="ldem_16"), "ldem_16.img")
    km = np.fromfile(path, dtype="<i2").reshape(2880, 5760).astype(np.float32) * 0.0005
    img = Image.fromarray(km, mode="F").resize((4096, 2048), Image.LANCZOS)
    return np.asarray(img, dtype=np.float32)


# ------------------------------------------------------------- validation --


def sample_bilinear(arr, lat, lon, lat_top, lon_left, ppd):
    """Sample a north-up, west-left grid at lat/lon (degrees) with pixel-center convention."""
    y = (lat_top - lat) * ppd - 0.5
    x = (lon - lon_left) * ppd - 0.5
    y0 = np.clip(np.floor(y).astype(int), 0, arr.shape[0] - 2)
    x0 = np.clip(np.floor(x).astype(int), 0, arr.shape[1] - 2)
    fy, fx = y - y0, x - x0
    a = arr[y0, x0] * (1 - fx) + arr[y0, x0 + 1] * fx
    b = arr[y0 + 1, x0] * (1 - fx) + arr[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy


def compare(name, fine, fine_spec, coarse, coarse_spec, half_extent):
    rng = np.random.default_rng(1)
    lat = rng.uniform(-half_extent, half_extent, 20000)
    lon = rng.uniform(-half_extent, half_extent, 20000)
    a = sample_bilinear(fine, lat, lon, *fine_spec)
    b = sample_bilinear(coarse, lat, lon, *coarse_spec)
    d = a - b
    corr = np.corrcoef(a, b)[0, 1]
    print(f"  {name}: mean diff {d.mean() * 1000:7.1f} m   rms {d.std() * 1000:6.1f} m   corr {corr:.4f}")
    if corr < 0.95 or abs(d.mean()) > 0.15:
        sys.exit(f"  !! {name} disagree — projection/orientation bug, aborting")


# ----------------------------------------------------------------- export --


def write_height_webp(q: np.ndarray, path: Path) -> None:
    """Lossless WebP holding 16-bit steps as R = high byte, G = low byte (B = 0).
    WebP's predictors and colour transforms compress this ~30% smaller than a
    16-bit PNG, and it stays bit-exact (decoded with colour conversion off)."""
    q = q.astype(np.uint16)
    rgb = np.zeros(q.shape + (3,), np.uint8)
    rgb[..., 0] = q >> 8
    rgb[..., 1] = q & 255
    Image.fromarray(rgb).save(path, "WEBP", lossless=True, quality=100, method=6)


def save_height(arr_km: np.ndarray, name: str, quantum_m: float) -> dict:
    """16-bit steps of `quantum_m`, stored losslessly as WebP (see write_height_webp).
    Steps are kept well below each source's vertical accuracy (LOLA ~1 m,
    SLDEM2015 ~3-4 m); finer steps only add incompressible noise bits.
    Decode: h = hMin + v / 65535 * (hMax - hMin)."""
    lo = float(arr_km.min())
    quantum_km = quantum_m / 1000
    q = np.round((arr_km - lo) / quantum_km)
    if q.max() > 65535:
        sys.exit(f"  !! {name}: range too large for {quantum_m} m steps")
    q = q.astype(np.uint16)
    path = OUT / f"{name}.webp"
    write_height_webp(q, path)
    hi = lo + 65535 * quantum_km
    print(f"  wrote {path.name}  {q.shape[1]}x{q.shape[0]}  {path.stat().st_size / 1e6:.1f} MB  "
          f"range {lo:.3f}..{float(arr_km.max()):.3f} km  step {quantum_m} m")
    return {"file": path.name, "width": q.shape[1], "height": q.shape[0], "hMin": lo, "hMax": hi}


def build_color() -> dict:
    path = download(SVS_MOON.format(name="lroc_color_poles_8k.tif"), "lroc_color_poles_8k.tif")
    rgb = np.asarray(Image.open(path).convert("RGB"))
    h, w, _ = rgb.shape
    lum = rgb.astype(np.float32).mean(axis=2)

    # Determine where longitude 0 sits by testing known dark maria vs. bright highlands.
    maria = [(17, 59), (28, 17), (8, 31), (-21, -17), (20, -30)]  # Crisium, Serenitatis, Tranquillitatis, Nubium, Imbrium
    highlands = [(-30, 10), (-45, 20), (-20, 60), (10, 120), (-60, 0)]

    def mean_at(points, lon0_col):
        vals = []
        for lat, lon in points:
            y = int((90 - lat) / 180 * h)
            x = int((lon0_col + lon / 360 * w) % w)
            vals.append(lum[max(0, y - 6) : y + 6, max(0, x - 6) : x + 6].mean())
        return float(np.mean(vals))

    scores = {c: mean_at(highlands, c) - mean_at(maria, c) for c in (0, w // 2)}
    lon0_col = max(scores, key=scores.get)
    print(f"  color: highland-minus-maria contrast {scores} -> lon 0 at column {lon0_col}")
    rgb = np.roll(rgb, -lon0_col, axis=1)

    out = {}
    for label, size in (("8k", (8192, 4096)), ("4k", (4096, 2048))):
        img = Image.fromarray(rgb)
        if img.size != size:
            img = img.resize(size, Image.LANCZOS)
        p = OUT / f"color_{label}.webp"
        img.save(p, quality=90, method=6)
        out[label] = p.name
        print(f"  wrote {p.name}  {p.stat().st_size / 1e6:.1f} MB")
    return out


def build_stars() -> dict:
    import OpenEXR

    path = download(SVS_STARS.format(name="starmap_2020_8k.exr"), "starmap_2020_8k.exr")
    with OpenEXR.File(str(path)) as f:
        ch = f.channels()
        if "RGB" in ch:
            rgb = np.asarray(ch["RGB"].pixels, dtype=np.float32)
        else:
            rgb = np.stack([np.asarray(ch[c].pixels, dtype=np.float32) for c in "RGB"], axis=-1)
    rgb = np.nan_to_num(np.maximum(rgb, 0))
    lum = rgb.mean(axis=2)
    p50, p99, p9999 = np.percentile(lum, [50, 99, 99.99])
    print(f"  stars: luminance p50 {p50:.4g}  p99 {p99:.4g}  p99.99 {p9999:.4g}")

    # Soft-clip so the brightest stars saturate and the Milky Way stays faint.
    k = -math.log(1 - 0.92) / p9999
    mapped = 1 - np.exp(-rgb * k)
    srgb = np.where(mapped <= 0.0031308, mapped * 12.92, 1.055 * np.power(mapped, 1 / 2.4) - 0.055)
    img8 = np.clip(srgb * 255 + 0.5, 0, 255).astype(np.uint8)

    # Source: RA 0h at center, RA increasing to the left. Output: col 0 = RA 0h, increasing right.
    img8 = np.roll(img8[:, ::-1], -img8.shape[1] // 2, axis=1)

    out = {}
    for label, size in (("8k", (8192, 4096)), ("4k", (4096, 2048))):
        img = Image.fromarray(img8)
        if img.size != size:
            img = img.resize(size, Image.LANCZOS)
        p = OUT / f"stars_{label}.webp"
        img.save(p, quality=72 if label == "8k" else 88, method=6)
        out[label] = p.name
        print(f"  wrote {p.name}  {p.stat().st_size / 1e6:.1f} MB")
    return out


def main():
    t0 = time.time()
    print("[1/6] l0  SLDEM2015 512 ppd")
    l0 = build_l0()
    print("[2/6] l1  SLDEM2015 128 ppd")
    l1 = build_l1()
    print("[3/6] l2  LOLA LDEM_64 -> 32 ppd")
    l2 = build_l2()
    print("[4/6] global  LOLA LDEM_16")
    glob = build_global()

    for name, arr in (("l0", l0), ("l1", l1), ("l2", l2), ("global", glob)):
        bad = ~np.isfinite(arr) | (np.abs(arr) > 25)
        if bad.any():
            sys.exit(f"  !! {name} has {bad.sum()} invalid samples")

    print("  cross-checking levels (same terrain sampled from each):")
    # grids: (lat_top, lon_left, ppd); global uses lon 0..360 so shift test lon into range
    compare("l0 vs l1", l0, (3, -3, 512), l1, (8, -8, 128), 2.9)
    compare("l1 vs l2", l1, (8, -8, 128), l2, (32, -32, 32), 7.9)
    pad = 640  # > 32° of wrap-around so negative-longitude samples stay in range
    g_ext = np.hstack([glob[:, -pad:], glob, glob[:, :pad]])
    g_ppd = 4096 / 360
    compare("l2 vs global", l2, (32, -32, 32), g_ext, (90, -pad / g_ppd, g_ppd), 31)

    print("[5/6] color + stars")
    color = build_color()
    stars = build_stars()

    print("[6/6] heights -> 16-bit PNG")
    manifest = {
        "radiusKm": R_KM,
        "global": {**save_height(glob, "height_global", 2.0), "source": "LRO LOLA LDEM_16"},
        "patches": [
            {**save_height(l0, "height_l0", 0.25), "ppd": 512, "latCenter": 0, "lonCenter": 0, "extentDeg": 6, "source": "SLDEM2015 (LOLA + SELENE TC)"},
            {**save_height(l1, "height_l1", 0.5), "ppd": 128, "latCenter": 0, "lonCenter": 0, "extentDeg": 16, "source": "SLDEM2015 (LOLA + SELENE TC)"},
            {**save_height(l2, "height_l2", 1.0), "ppd": 32, "latCenter": 0, "lonCenter": 0, "extentDeg": 64, "source": "LRO LOLA LDEM_64"},
        ],
        "color": color,
        "stars": stars,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    total = sum(p.stat().st_size for p in OUT.iterdir()) / 1e6
    print(f"done in {time.time() - t0:.0f}s — public/moon total {total:.1f} MB")


if __name__ == "__main__":
    main()
