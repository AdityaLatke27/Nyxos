"""Polar subset of the Lunar Prospector neutron-spectrometer hydrogen maps (PDS Geosciences Node, special reduced products).
Feldman et al. 2001 JGR. Units: ppm H by weight. hydrogenlow = 11306 equal-area bins (~60 km); hydrogenhd = 0.5 degree bins."""
import json, sys
def rows(p):
    out = []
    for l in open(p):
        if l.startswith('#') or not l.strip(): continue
        a = [float(x) for x in l.split(',')]
        out.append(a)
    return out
low = [r for r in rows('w/hydrogenlow.txt') if r[1] <= -80.0]
hd = rows('w/hydrogenhd.txt')
hd = [r for r in hd if r[1] <= -80.0]
# half-degree grid is regular: 720 lon x N lat, row-major from -90, lon from -180
ppm = [round(r[4], 2) for r in hd]
assert len(hd) % 720 == 0
json.dump({
  'source': 'NASA Lunar Prospector neutron spectrometer, hydrogen maps (Feldman et al. 2001, JGR), PDS Geosciences Node special reduced products',
  'units': 'ppm H by weight', 'latMax': -80.0,
  'low': [[r[0], r[1], r[2], r[3], r[4]] for r in low],
  'hd': {'latMin': -90.0, 'step': 0.5, 'lonMin': -180.0, 'cols': 720, 'rows': len(hd) // 720, 'ppm': ppm},
}, open('w/lp_h.json', 'w'), separators=(',', ':'))
print('low cells', len(low), 'hd cells', len(hd))
