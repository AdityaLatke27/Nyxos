"""Polar subset (lat < -80) of LU5M812TGT (La Grassa et al. 2025, ISPRS J. Photogramm. Remote Sens.; Zenodo 10.5281/zenodo.13990480, CC BY 4.0),
plus a check of its diameters against the IAU-named craters in public/sim/features.json."""
import csv, gzip, json, math, statistics as st
src = 'w/c.csv'
rows = []
with open(src) as f:
    r = csv.reader(f); h = next(r)
    iLon, iLat, iDh, iDw, iC = h.index('Longitude'), h.index('Latitude'), h.index('Diameter_h'), h.index('Diameter_w'), h.index('Confidence')
    n = 0
    for a in r:
        n += 1
        lat = float(a[iLat])
        if lat < -80.0:
            rows.append((float(a[iLon]), lat, float(a[iDh]), float(a[iDw]), float(a[iC])))
print('total', n, 'polar', len(rows))
with gzip.open('w/polar_raw.csv.gz', 'wt') as o:
    o.write('lon,lat,dh,dw,conf\n')
    for x in rows: o.write('%.5f,%.5f,%.4f,%.4f,%.4f\n' % x)
ds = [max(x[2], x[3]) for x in rows]
print('lon range', min(x[0] for x in rows), max(x[0] for x in rows))
print('D>=0.4', sum(1 for d in ds if d >= .4), 'D>=1', sum(1 for d in ds if d >= 1), 'D>=5', sum(1 for d in ds if d >= 5))
print('aspect dh/dw median', st.median(x[2] / x[3] for x in rows if x[3] > 0))
print('conf quartiles', st.quantiles([x[4] for x in rows], n=4))
# validation vs IAU-named craters
feat = json.load(open('public/sim/features.json'))
cr = [f for f in feat if f[4] == 'crater' and f[1] < -80 and f[3] >= 8]
print('named polar craters >= 8 km', len(cr))
def xy(lat, lon):
    rho = 2 * 1737.4 * math.tan(math.pi / 4 + math.radians(lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))
pts = [(xy(x[1], x[0]), x) for x in rows if max(x[2], x[3]) >= 4]
out = []
for f in cr:
    fx, fy = xy(f[1], f[2]); D = f[3]
    best = None
    for (px, py), x in pts:
        d = math.hypot(px - fx, py - fy)
        if d < 0.35 * D:
            sc = abs(math.log(max(x[2], x[3]) / D))
            if best is None or sc < best[0]: best = (sc, d, x)
    if best: out.append((f[0], D, best[2][2], best[2][3], best[2][4], best[1]))
    else: out.append((f[0], D, None, None, None, None))
for o in out: print('%-22s named %.1f km  catalog dh %s dw %s conf %s offset %s km' % (o[0][:22], o[1], *(('%.1f' % v if v is not None else '-') for v in o[2:])))
ok = [o for o in out if o[2] is not None]
print('matched', len(ok), 'of', len(out))
if ok:
    print('median dh/D', st.median(o[2] / o[1] for o in ok), 'median dw/D', st.median(o[3] / o[1] for o in ok), 'median max/D', st.median(max(o[2], o[3]) / o[1] for o in ok), 'median mean/D', st.median((o[2] + o[3]) / 2 / o[1] for o in ok))
