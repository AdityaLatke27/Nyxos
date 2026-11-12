/**
 * Regional hydrogen context from the Lunar Prospector neutron spectrometer (Feldman et al. 2001, JGR), the
 * reduced hydrogen maps on the PDS Geosciences Node. Hydrogen is given in ppm by weight, in the top ~1 m. The
 * footprint of the instrument is tens of kilometres, far larger than a landing site, so this is regional context and
 * never evidence of ice at the site.
 */
export interface LpHydrogenData {
  source: string
  units: string
  /** equal-area bins poleward of 80 degrees south: [latMin, latMax, lonMin, lonMax, ppm] */
  low: [number, number, number, number, number | null][]
  hd: { latMin: number; step: number; lonMin: number; cols: number; rows: number; ppm: (number | null)[] }
}
export interface LpHydrogenSite {
  lowPpm: number
  lowCell: { latSpanDeg: number; lonSpanDeg: number; widthKm: number }
  hdPpm: number | null
  /** share of the 60 km equal-area cells poleward of 80°S with a hydrogen value at or below this site's */
  percentile: number
  capMinPpm: number
  capMaxPpm: number
}

export async function loadLpHydrogen(base = '/landing'): Promise<LpHydrogenData | null> {
  try {
    const r = await fetch(`${base}/lp_h.json`)
    if (!r.ok) return null
    return (await r.json()) as LpHydrogenData
  } catch {
    return null
  }
}

export function lpHydrogenAt(d: LpHydrogenData, lat: number, lon: number): LpHydrogenSite | null {
  if (lat > -80) return null
  const L = ((((lon + 180) % 360) + 360) % 360) - 180
  const cell = d.low.find((c) => lat >= c[0] && lat < c[1] + (c[1] >= -80 ? 1e-9 : 0) && L >= c[2] && L < c[3])
    ?? d.low.find((c) => lat >= c[0] && lat <= c[1] && L >= c[2] && L <= c[3])
  if (!cell || cell[4] === null) return null
  const vals = d.low.map((c) => c[4]).filter((v): v is number => v !== null)
  const widthKm = ((cell[3] - cell[2]) * Math.PI / 180) * Math.cos(((cell[0] + cell[1]) / 2) * Math.PI / 180) * 1737.4
  const h = d.hd
  const row = Math.floor((lat - h.latMin) / h.step)
  const col = Math.floor((L - h.lonMin) / h.step)
  const hdPpm = row >= 0 && row < h.rows && col >= 0 && col < h.cols ? h.ppm[row * h.cols + col] : null
  return {
    lowPpm: cell[4],
    lowCell: { latSpanDeg: cell[1] - cell[0], lonSpanDeg: cell[3] - cell[2], widthKm },
    hdPpm,
    percentile: (100 * vals.filter((v) => v <= cell[4]!).length) / vals.length,
    capMinPpm: Math.min(...vals),
    capMaxPpm: Math.max(...vals),
  }
}
