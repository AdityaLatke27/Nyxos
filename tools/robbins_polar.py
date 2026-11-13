"""Polar subset of the Robbins (2019, Meteoritics & Planetary Science) lunar crater database (USGS Astrogeology, 2018-08-15 release)
and a check of its diameters against the IAU-named craters in public/sim/features.json."""
import csv, glob, gzip, json, math, os, statistics as st, sys, zipfile
p = 'w/robbins.dl'
print('file', os.path.getsize(p), open(p, 'rb').read(8))
if zipfile.is_zipfile(p):
    z = zipfile.ZipFile(p); print([ (i.filename, i.file_size) for i in z.infolist()][:20]); z.extractall('w/x')
else:
    os.makedirs('w/x', exist_ok=True); os.replace(p, 'w/x/robbins.csv')
files = sorted(glob.glob('w/x/**/*.csv', recursive=True)); print(files)
big = max(files, key=os.path.getsize); print('using', big, os.path.getsize(big))
f = open(big, newline='', encoding='utf-8', errors='replace')
r = csv.reader(f); h = [x.strip() for x in next(r)]; print(h)
ix = {k: i for i, k in enumerate(h)}
iLat, iLon, iD = ix['LAT_CIRC_IMG'], ix['LON_CIRC_IMG'], ix['DIAM_CIRC_IMG']
iSD = ix.get('DIAM_CIRC_SD_IMG'); iId = ix.get('CRATER_ID'); iN = ix.get('NUMBER_USED') ; iDM = ix.get('DIAM_ELLI_MAJOR_IMG')
rows = []; n = 0
for a in r:
    n += 1
    try: lat = float(a[iLat])
    except: continue
    if lat < -80.0:
        rows.append((float(a[iLon]), lat, float(a[iD]), float(a[iSD]) if iSD is not None and a[iSD] else -1, a[iId] if iId is not None else ''))
print('total', n, 'polar', len(rows))
with gzip.open('w/robbins_polar.csv.gz', 'wt') as o:
    o.write('lon,lat,diam_km,diam_sd_km,id\n')
    for x in rows: o.write('%.5f,%.5f,%.4f,%.4f,%s\n' % x)
ds = [x[2] for x in rows]
print('lon range', min(x[0] for x in rows), max(x[0] for x in rows))
for t in (1, 2, 5, 10): print('D>=%g km' % t, sum(1 for d in ds if d >= t))
print('density D>=1 km per 1000 km^2 in 80-90S cap (area %.0f km^2): %.1f' % (math.pi * 303.5 ** 2, 1000 * sum(1 for d in ds if d >= 1) / (math.pi * 303.5 ** 2)))
def xy(lat, lon):
    rho = 2 * 1737.4 * math.tan(math.pi / 4 + math.radians(lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))
feat = json.load(open('public/sim/features.json'))
cr = [f for f in feat if f[4] == 'crater' and f[1] < -80 and f[3] >= 8]
pts = [(xy(x[1], x[0]), x) for x in rows if x[2] >= 4]
out = []
for f in cr:
    fx, fy = xy(f[1], f[2]); D = f[3]; best = None
    for (px, py), x in pts:
        d = math.hypot(px - fx, py - fy)
        if d < 0.35 * D:
            sc = abs(math.log(x[2] / D))
            if best is None or sc < best[0]: best = (sc, d, x)
    out.append((f[0], D, best[2][2] if best else None, best[1] if best else None))
for o in out: print('%-22s named %.1f km  robbins %s km  offset %s km' % (o[0][:22], o[1], *(('%.1f' % v if v is not None else '-') for v in o[2:])))
ok = [o for o in out if o[2] is not None]
print('matched', len(ok), 'of', len(out), 'median robbins/D %.3f' % st.median(o[2] / o[1] for o in ok), 'min %.2f max %.2f' % (min(o[2] / o[1] for o in ok), max(o[2] / o[1] for o in ok)))
