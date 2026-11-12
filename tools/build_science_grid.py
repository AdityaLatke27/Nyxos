"""Science grid on the Diviner 240 m south-polar grid (80-90 S): temperatures and cold-trap evidence.

Layers (Williams et al. 2019, JGR 124; Schorghofer & Williams 2020, PSJ 1, 54; Diviner level 4 polar products,
http://luna1.diviner.ucla.edu/~jpierre/diviner/level4_polar/):
  Tmax  maximum bolometric temperature [K]      (24x6_240m/additional_maps/polar_south_80_Tmax)
  Tmean mean bolometric temperature [K]         (.../polar_south_80_Tmean)
  zit   ice-table depth derived from the thermal model [m] (.../polar_south_80_zit)
  f110s / f110w  fraction of a lunation below 110 K, south summer / winter (additional_maps/fraction_below_110_south_*)
  psr   fraction of the 240 m bin inside a LOLA PSR (PGDA LPSR_80S_20MPP_ADJ, 20 m/px)
Output: s1.png (R,G,B = Tmax,Tmean,zit) and s2.png (R,G,B = f110s,f110w,psr) + science.json with the exact scale of each layer.
Every layer is quantised to 8 bit with the (lo, hi) range written to science.json; 255 = no data.
The Diviner grid orientation is not assumed: it is identified by maximising the contrast between mean Tmax inside and
outside the LOLA PSR mask over the 8 axis flips / transposes, and the result is printed and stored.
"""
import json, os, subprocess, sys
import numpy as np, rasterio
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
WORK = os.environ.get("WORK", "/mnt/work")
os.makedirs(WORK, exist_ok=True); os.makedirs(OUT, exist_ok=True)
D = "https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_polar/"
LAY = {
    "Tmax": "24x6_240m/additional_maps/polar_south_80_Tmax.grd",
    "Tmean": "24x6_240m/additional_maps/polar_south_80_Tmean.grd",
    "zit": "24x6_240m/additional_maps/polar_south_80_zit.grd",
    "f110s": "additional_maps/fraction_below_110_south_summer.grd",
    "f110w": "additional_maps/fraction_below_110_south_winter.grd",
}
for extra in ("24x6_240m/additional_maps/aareadme.txt", "additional_maps/fraction_below_110_south_summer.txt"):
    subprocess.run(["curl", "-sSL", "-k", "--ciphers", "DEFAULT@SECLEVEL=0", "-m", "120", "-o", os.path.join(WORK, os.path.basename(extra)), D + extra])
    print("=====", extra); print(open(os.path.join(WORK, os.path.basename(extra)), errors="replace").read()[:3000])

def fetch(rel):
    dst = os.path.join(WORK, os.path.basename(rel))
    subprocess.run(["curl", "-sSL", "-k", "--ciphers", "DEFAULT@SECLEVEL=0", "-m", "600", "-o", dst, D + rel], check=True)
    print(rel, os.path.getsize(dst), "bytes", flush=True)
    return dst

def read_grd(path):
    """Return (array[row0 = max y], x0, x1, y0, y1) from a GMT grd (netCDF/HDF5)."""
    try:
        import netCDF4
        ds = netCDF4.Dataset(path)
        print(path, "variables:", {k: (v.dimensions, v.shape, getattr(v, "units", ""), getattr(v, "long_name", "")) for k, v in ds.variables.items()})
        print("attrs:", {k: ds.getncattr(k) for k in ds.ncattrs()})
        z = np.ma.filled(ds.variables["z"][:].astype("float64"), np.nan)
        x = np.asarray(ds.variables["x"][:]); y = np.asarray(ds.variables["y"][:])
        if y[0] < y[-1]:
            z = z[::-1]; y = y[::-1]
        return z, float(x[0]), float(x[-1]), float(y[-1]), float(y[0]), ds
    except Exception as e:
        print("netCDF4 failed:", repr(e))
        r = rasterio.open(path)
        print(r.profile)
        b = r.bounds
        return r.read(1).astype("float64"), b.left, b.right, b.bottom, b.top, None

layers, ext = {}, None
for k, rel in LAY.items():
    p = fetch(rel)
    z, x0, x1, y0, y1, ds = read_grd(p)
    print(k, "shape", z.shape, "x", x0, x1, "y", y0, y1, "finite", np.isfinite(z).mean(), "min/max", np.nanmin(z), np.nanmax(z), "pct", np.nanpercentile(z, [1, 50, 99]))
    layers[k] = z
    ext = (x0, x1, y0, y1)
shape = layers["Tmax"].shape
assert all(v.shape == shape for v in layers.values()), {k: v.shape for k, v in layers.items()}
x0, x1, y0, y1 = ext
# grid in metres: Diviner x,y are distances from the pole normalised by 1737.4 km
scale = 1737400.0 if max(abs(x0), abs(x1)) < 2 else 1.0
n = shape[0]
print("grid", shape, "extent m", [v * scale for v in ext], "pixel m", (x1 - x0) * scale / (shape[1] - 1))

# PSR fraction at the Diviner grid from the LOLA 20 m PSR raster
psr_path = os.path.join(WORK, "LPSR_80S_20MPP_ADJ.TIF")
subprocess.run(["aria2c", "-q", "-x", "16", "-s", "16", "-k", "4M", "--user-agent=Mozilla/5.0 NYXOS", "-d", WORK, "-o", "LPSR_80S_20MPP_ADJ.TIF",
                "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LPSR_80S_20MPP_ADJ.TIF"], check=True)
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds
dst_t = from_bounds(x0 * scale - 0.5 * (x1 - x0) * scale / (shape[1] - 1), y0 * scale - 0.5 * (y1 - y0) * scale / (shape[0] - 1),
                    x1 * scale + 0.5 * (x1 - x0) * scale / (shape[1] - 1), y1 * scale + 0.5 * (y1 - y0) * scale / (shape[0] - 1), shape[1], shape[0])
psr = np.full(shape, np.nan, "float32")
with rasterio.open(psr_path) as src:
    reproject(rasterio.band(src, 1), psr, src_transform=src.transform, src_crs=src.crs, dst_transform=dst_t, dst_crs=src.crs,
              resampling=Resampling.average, src_nodata=np.nan, dst_nodata=np.nan)
print("psr fraction mean", np.nanmean(psr))

# orientation search against PSR
tm = layers["Tmax"]
best = None
for tr in (False, True):
    for fy in (False, True):
        for fx in (False, True):
            a = tm.T if tr else tm
            a = a[::-1] if fy else a
            a = a[:, ::-1] if fx else a
            m = np.isfinite(a) & np.isfinite(psr)
            inn = a[m & (psr > 0.9)]; out_ = a[m & (psr < 0.01)]
            if len(inn) < 100 or len(out_) < 100:
                continue
            c = np.mean(out_) - np.mean(inn)
            print(f"orientation transpose={tr} flipY={fy} flipX={fx}: mean Tmax outside PSR - inside PSR = {c:.1f} K (n_in={len(inn)})")
            if best is None or c > best[0]:
                best = (c, tr, fy, fx)
print("BEST orientation", best)
c, tr, fy, fx = best
def orient(a):
    a = a.T if tr else a
    a = a[::-1] if fy else a
    return a[:, ::-1] if fx else a
layers = {k: orient(v) for k, v in layers.items()}
layers["psr"] = psr
meta = dict(schema=1, frame="south-polar stereographic, lat_ts=-90, lon_0=0, R=1737400 m; row 0 = +y, column 0 = -x",
            halfExtentM=(x1 - x0) * scale / 2 + 0.5 * (x1 - x0) * scale / (shape[1] - 1), pixelM=(x1 - x0) * scale / (shape[1] - 1), size=list(shape),
            orientation=dict(transpose=tr, flipY=fy, flipX=fx, psrContrastK=round(float(c), 2)),
            sources=D, layers={})
def q8(name, a, lo, hi):
    v = np.clip(np.round((a - lo) / (hi - lo) * 254), 0, 254)
    v = np.where(np.isfinite(a), v, 255).astype(np.uint8)
    meta["layers"][name] = dict(lo=lo, hi=hi, step=(hi - lo) / 254, nodata=255, validFraction=float(np.isfinite(a).mean()))
    return v
def rng(a):
    f = a[np.isfinite(a)]
    return float(np.floor(f.min())), float(np.ceil(np.percentile(f, 99.99)))
t1 = [q8(k, layers[k], *rng(layers[k])) for k in ("Tmax", "Tmean", "zit")]
f110 = lambda a: np.where(np.isfinite(a), a, np.nan)
t2 = [q8("f110s", layers["f110s"], 0.0, 1.0), q8("f110w", layers["f110w"], 0.0, 1.0), q8("psr", layers["psr"], 0.0, 1.0)]
Image.fromarray(np.stack(t1, -1), "RGB").save(os.path.join(OUT, "s1.png"), optimize=True)
Image.fromarray(np.stack(t2, -1), "RGB").save(os.path.join(OUT, "s2.png"), optimize=True)
json.dump(meta, open(os.path.join(OUT, "science.json"), "w"), indent=1)
print(json.dumps(meta, indent=1))
