"""Sample NASA's average-illumination maps (Mazarico et al., PGDA 'Lunar Polar Illumination') at random south-polar points.
Output CSV: map,lat,lon,x,y,value,scale,offset  (value already scaled; the maps average hourly Sun visibility over an 18.6 yr nutation cycle)."""
import csv, math, os, subprocess, sys, json
import numpy as np, rasterio
R = 1737400.0
B = "https://pgda.gsfc.nasa.gov/data/MoonIllumination/"
MAPS = [("AVGVISIB_85S_060M_201608.TIF", -90.0, -85.0, 400), ("AVGVISIB_75S_120M_201608.TIF", -85.0, -75.0, 400)]
rng = np.random.default_rng(20261112)
out = []
for name, lat0, lat1, n in MAPS:
    p = os.path.join("/tmp", name)
    ename = name.replace(".TIF", "_EARTH.TIF")
    for nm in (name, ename):
        subprocess.run(["aria2c", "-q", "-x", "8", "-s", "8", "--user-agent=Mozilla/5.0 NYXOS", "-d", "/tmp", "-o", nm, B + nm], check=True)
    with rasterio.open(p) as d, rasterio.open(os.path.join("/tmp", ename)) as de:
        assert de.bounds == d.bounds and de.shape == d.shape, (de.bounds, d.bounds)
        ae = de.read(1)
        print(name, d.dtypes, "scales", d.scales, "offsets", d.offsets, "nodata", d.nodata, d.res, d.bounds, flush=True)
        a = d.read(1)
        print("raw min/max", float(a.min()), float(a.max()), "tags", d.tags(1), flush=True)
        sc, off = d.scales[0], d.offsets[0]
        got = 0
        while got < n:
            lat = math.degrees(math.asin(rng.uniform(math.sin(math.radians(lat0)), math.sin(math.radians(lat1)))))
            lon = rng.uniform(-180, 180)
            rho = 2 * R * math.tan(math.pi / 4 + math.radians(lat) / 2)
            x, y = rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))
            r, c = d.index(x, y)
            if not (0 <= r < d.height and 0 <= c < d.width):
                continue
            v = float(a[r, c])
            if d.nodata is not None and v == d.nodata:
                continue
            ve = float(ae[r, c])
            if ve == de.nodata:
                continue
            out.append([name, round(lat, 5), round(lon, 5), round(x, 1), round(y, 1), v * sc + off, ve * de.scales[0] + de.offsets[0], sc, off]); got += 1
os.makedirs("out", exist_ok=True)
with open("out/avgvis_ref.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["map", "lat", "lon", "x", "y", "sun", "earth", "scale", "offset"]); w.writerows(out)
vals = np.array([[o[5], o[6]] for o in out]); print("sun range", vals[:,0].min(), vals[:,0].max(), "earth range", vals[:,1].min(), vals[:,1].max(), "means", vals.mean(axis=0))
