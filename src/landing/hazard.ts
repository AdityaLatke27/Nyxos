/**
 * Lander-scale slope hazard cells derived from NASA PGDA's LOLA south-polar slope maps
 * (see tools/build_landing_tiles.py). One cell = the 95th-percentile slope of the native
 * 10-60 m pixels it covers, the share steeper than 10°, and the mean slope error.
 */
const R_M = 1737400
const DEG = Math.PI / 180

/** South-polar stereographic metres (lat_ts = -90, lon_0 = 0): x toward 90°E, y toward 0°E. */
export function polarXY(latDeg: number, lonDeg: number): { x: number; y: number } {
  const rho = 2 * R_M * Math.tan(Math.PI / 4 + (latDeg * DEG) / 2)
  return { x: rho * Math.sin(lonDeg * DEG), y: rho * Math.cos(lonDeg * DEG) }
}

export function polarToLatLon(x: number, y: number): { lat: number; lon: number } {
  const rho = Math.hypot(x, y)
  const lat = (2 * Math.atan(rho / (2 * R_M)) - Math.PI / 2) / DEG
  return { lat, lon: rho === 0 ? 0 : Math.atan2(x, y) / DEG }
}

export interface TierMeta {
  id: string
  product: string
  errProduct: string | null
  nativeM: number
  cellM: number
  halfExtentM: number
  cells: number
  tilesPerSide: number
  tiles: [number, number][]
}
export interface Manifest {
  tileCells: number
  source: string
  tiers: TierMeta[]
}

export interface HazardCell {
  tier: string
  nativeM: number
  cellM: number
  /** 95th-percentile slope (deg) of native pixels in the cell */
  p95: number
  /** percent of native pixels steeper than 10° */
  frac10: number
  /** mean slope error (deg); null when the error product was unavailable */
  errDeg: number | null
  x: number
  y: number
}

/** RGBA pixels of one 256×256 tile, or null when absent. */
export type TileLoader = (tier: string, ty: number, tx: number) => Promise<Uint8ClampedArray | null>

export class HazardField {
  private cache = new Map<string, Uint8ClampedArray | null>()
  private have = new Map<string, Set<string>>()
  readonly manifest: Manifest
  private loader: TileLoader
  constructor(manifest: Manifest, loader: TileLoader) {
    this.manifest = manifest
    this.loader = loader
    for (const t of manifest.tiers) this.have.set(t.id, new Set(t.tiles.map(([a, b]) => `${a}_${b}`)))
  }

  private tileOf(t: TierMeta, x: number, y: number) {
    const T = this.manifest.tileCells
    const col = Math.floor((x + t.halfExtentM) / t.cellM)
    const row = Math.floor((t.halfExtentM - y) / t.cellM)
    if (col < 0 || row < 0 || col >= t.cells || row >= t.cells) return null
    return { col, row, ty: Math.floor(row / T), tx: Math.floor(col / T), ci: col % T, cj: row % T }
  }

  /** Load every tile that intersects a square of half-width radiusM around (x, y), all tiers. */
  async ensure(x: number, y: number, radiusM: number) {
    const jobs: Promise<void>[] = []
    for (const t of this.manifest.tiers) {
      const T = this.manifest.tileCells
      const lo = (v: number) => Math.max(0, Math.floor(v / T))
      const c0 = Math.floor((x - radiusM + t.halfExtentM) / t.cellM)
      const c1 = Math.floor((x + radiusM + t.halfExtentM) / t.cellM)
      const r0 = Math.floor((t.halfExtentM - (y + radiusM)) / t.cellM)
      const r1 = Math.floor((t.halfExtentM - (y - radiusM)) / t.cellM)
      for (let ty = lo(r0); ty <= Math.min(t.tilesPerSide - 1, Math.floor(r1 / T)); ty++)
        for (let tx = lo(c0); tx <= Math.min(t.tilesPerSide - 1, Math.floor(c1 / T)); tx++) {
          const key = `${t.id}_${ty}_${tx}`
          if (this.cache.has(key) || !this.have.get(t.id)!.has(`${ty}_${tx}`)) continue
          jobs.push(
            this.loader(t.id, ty, tx).then((d) => {
              this.cache.set(key, d)
            }),
          )
        }
    }
    await Promise.all(jobs)
  }

  /** Finest valid cell at polar (x, y) metres, or null outside every product. */
  cellAt(x: number, y: number): HazardCell | null {
    const T = this.manifest.tileCells
    for (const t of this.manifest.tiers) {
      const p = this.tileOf(t, x, y)
      if (!p) continue
      const d = this.cache.get(`${t.id}_${p.ty}_${p.tx}`)
      if (!d) continue
      const o = (p.cj * T + p.ci) * 4
      if (d[o] === 255) continue
      return {
        tier: t.id,
        nativeM: t.nativeM,
        cellM: t.cellM,
        p95: d[o] / 2,
        frac10: d[o + 1],
        errDeg: t.errProduct ? d[o + 2] / 10 : null,
        x: -t.halfExtentM + (p.col + 0.5) * t.cellM,
        y: t.halfExtentM - (p.row + 0.5) * t.cellM,
      }
    }
    return null
  }
}

/** Browser loader: fetches tile PNGs and decodes them with a canvas. */
export function browserLoader(base = '/landing'): TileLoader {
  return async (tier, ty, tx) => {
    try {
      const r = await fetch(`${base}/${tier}/${ty}_${tx}.png`)
      if (!r.ok) return null
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const g = c.getContext('2d', { willReadFrequently: true })!
      g.drawImage(bmp, 0, 0)
      return g.getImageData(0, 0, bmp.width, bmp.height).data
    } catch {
      return null
    }
  }
}

export async function loadManifest(base = '/landing'): Promise<Manifest | null> {
  try {
    const r = await fetch(`${base}/manifest.json`)
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null
    return (await r.json()) as Manifest
  } catch {
    return null
  }
}
