"""Sample JPL DE440 Sun and Earth directions in the Moon mean-Earth/polar-axis frame.

Writes public/landing/eph.f32 (little-endian float32, 7 values per hourly sample:
sun dir x,y,z, earth dir x,y,z in the NYXOS scene frame, earth distance km) and
public/landing/eph.json (epoch, step, count, kernels used, comparison with Horizons).
Scene frame = (body y, body z, body x) of MOON_ME: +Y north pole, +Z 0N0E, +X 0N90E.
"""
import json, math, os, re, subprocess, sys
import numpy as np
import spiceypy as sp

BASE = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
KDIR = "kernels"
os.makedirs(KDIR, exist_ok=True)


def listing(path):
    out = subprocess.run(["curl", "-sSL", "-A", "Mozilla/5.0 NYXOS", BASE + path], capture_output=True, text=True).stdout
    return re.findall(r'href="([^"?/][^"]*)"', out)


def pick(path, pattern):
    names = sorted(n for n in listing(path) if re.fullmatch(pattern, n))
    if not names:
        sys.exit(f"no kernel in {path} matching {pattern}")
    return path + names[-1]


paths = [
    "lsk/naif0012.tls",
    "spk/planets/de440s.bsp",
    pick("pck/", r"moon_pa_de440_\d+\.bpc"),
    pick("pck/", r"pck\d+\.tpc"),
    pick("fk/satellites/", r"moon_de440_\d+\.tf"),
]
for p in paths:
    dst = os.path.join(KDIR, os.path.basename(p))
    if not os.path.exists(dst):
        subprocess.run(["curl", "-sSL", "-f", "-A", "Mozilla/5.0 NYXOS", "-o", dst, BASE + p], check=True)
    sp.furnsh(dst)
    print("kernel", p, os.path.getsize(dst), flush=True)

FRAME = "MOON_ME_DE440_ME421"
START = "2026-01-01T00:00:00"
STEP = 3600
N = 3652 * 24 + 1
et0 = sp.str2et(START + " UTC")
ets = et0 + STEP * np.arange(N)
out = np.zeros((N, 7), dtype="<f4")
for i, et in enumerate(ets):
    s, _ = sp.spkpos("SUN", et, FRAME, "LT+S", "MOON")
    e, _ = sp.spkpos("EARTH", et, FRAME, "LT+S", "MOON")
    s = np.array(s)
    e = np.array(e)
    d = np.linalg.norm(e)
    for k, v in enumerate((s / np.linalg.norm(s), e / d)):
        out[i, 3 * k:3 * k + 3] = (v[1], v[2], v[0])
    out[i, 6] = d


def sun_azel(et, lat, lon):
    s, _ = sp.spkpos("SUN", et, FRAME, "LT+S", "MOON")
    s = np.array(s) / np.linalg.norm(s)
    la, lo = math.radians(lat), math.radians(lon)
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    north = np.cross(up, east)
    el = math.degrees(math.asin(np.dot(s, up)))
    az = math.degrees(math.atan2(np.dot(s, east), np.dot(s, north))) % 360
    return az, el


rows = [l.strip().split(",") for l in open("tools/horizons_ref.csv")][1:]
de, da = [], []
for site, lon, lat, t, az, el in rows:
    et = sp.str2et(t.strip() + " UTC")
    a, e_ = sun_azel(et, float(lat), float(lon))
    de.append(abs(e_ - float(el)))
    if abs(float(lat)) < 89.5:
        da.append(abs((a - float(az) + 180) % 360 - 180))
cmp = dict(rows=len(rows), elevation_err_deg_max=max(de), elevation_err_deg_median=float(np.median(de)),
           azimuth_err_deg_max=max(da) if da else None)
print("SPICE vs Horizons", cmp, flush=True)

os.makedirs("public/landing", exist_ok=True)
out.tofile("public/landing/eph.f32")
json.dump(dict(epochUtc=START + "Z", stepSeconds=STEP, count=N, floatsPerSample=7, frame=FRAME,
               aberration="LT+S", kernels=[os.path.basename(p) for p in paths], spiceVsHorizons=cmp),
          open("public/landing/eph.json", "w"), separators=(",", ":"))
print("wrote", os.path.getsize("public/landing/eph.f32"), flush=True)
