/**
 * Terrain and science layers for the landing analysis, built in CI from NASA data
 * (tools/build_terrain_tiles.py, tools/build_science_grid.py):
 *  - 100 m-baseline plane-fit slope, 100 m-baseline roughness, PSR share, mean height and relief
 *    per hazard cell (PGDA LDRM / LDEM / LPSR, Barker et al.; 50 m and 20 m pixels, 80–90°S)
 *  - Diviner temperatures, ice-table depth and cold-trap fractions on a 240 m grid (80–90°S)
 */
import type { TileLoader } from './hazard'

export interface TerrainTier {
  id: string
  cellM: number
  halfExtentM: number
  cells: number
  tilesPerSide: number
  tiles: [number, number][]
}
export interface TerrainMeta {
  tileCells: number
  source: string
  tiers: TerrainTier[]
}
export interface TerrainCell {
  tier: string
  cellM: number
  /** maximum plane-fit slope over a 100 m baseline in the cell (deg) */
  slope100: number
  /** maximum RMS residual about the 100 m plane in the cell (m) */
  roughM: number
  /** percent of the cell inside a permanently shadowed region */
  psrPct: number
  /** mean height relative to the 1737.4 km reference sphere (m), null if absent */
  heightM: number | null
  /** max − min height inside the cell (m, saturates at 250) */
  reliefM: number | null
  x: number
  y: number
}

export interface ScienceMeta {
  halfExtentM: number
  pixelM: number
  size: [number, number]
  layers: Record<string, { lo: number; hi: number; step: number; nodata: number }>
  sources: string
}
export interface ScienceSample {
  tmaxK: number | null
  tmeanK: number | null
  /** depth (m) to the stable ice table from the Diviner thermal model, null = none within the model limit */
  iceTableM: number | null
  f110Summer: number | null
  f110Winter: number | null
  psrFrac: number | null
}

/** Decoded RGBA of s1.png (Tmax, Tmean, zit) and s2.png (f110 summer, f110 winter, psr). */
export class ScienceGrid {
  readonly meta: ScienceMeta
  private s1: Uint8ClampedArray
  private s2: Uint8ClampedArray
  constructor(meta: ScienceMeta, s1: Uint8ClampedArray, s2: Uint8ClampedArray) {
    this.meta = meta
    this.s1 = s1
    this.s2 = s2
  }
  private idx(x: number, y: number): number {
    const m = this.meta
    const col = Math.floor((x + m.halfExtentM) / m.pixelM)
    const row = Math.floor((m.halfExtentM - y) / m.pixelM)
    if (col < 0 || row < 0 || col >= m.size[1] || row >= m.size[0]) return -1
    return (row * m.size[1] + col) * 4
  }
  private dec(d: Uint8ClampedArray, o: number, c: number, name: string): number | null {
    const v = d[o + c]
    if (v === 255) return null
    const l = this.meta.layers[name]
    return l.lo + v * l.step
  }
  at(x: number, y: number): ScienceSample | null {
    const o = this.idx(x, y)
    if (o < 0) return null
    return {
      tmaxK: this.dec(this.s1, o, 0, 'Tmax'),
      tmeanK: this.dec(this.s1, o, 1, 'Tmean'),
      iceTableM: this.dec(this.s1, o, 2, 'zit'),
      f110Summer: this.dec(this.s2, o, 0, 'f110s'),
      f110Winter: this.dec(this.s2, o, 1, 'f110w'),
      psrFrac: this.dec(this.s2, o, 2, 'psr'),
    }
  }
}

export interface PsrSearch {
  /** distance (m) from the site to the nearest cell that is at least half PSR; 0 = inside */
  distM: number
  psrPct: number
  x: number
  y: number
}

export class TerrainField {
  private cache = new Map<string, Uint8ClampedArray | null>()
  private have = new Map<string, Set<string>>()
  readonly meta: TerrainMeta
  private loadT: TileLoader
  private loadE: TileLoader
  readonly science: ScienceGrid | null
  constructor(meta: TerrainMeta, loadT: TileLoader, loadE: TileLoader, science: ScienceGrid | null) {
    this.meta = meta
    this.loadT = loadT
    this.loadE = loadE
    this.science = science
    for (const t of meta.tiers) this.have.set(t.id, new Set(t.tiles.map(([a, b]) => `${a}_${b}`)))
  }

  private tileOf(t: TerrainTier, x: number, y: number) {
    const T = this.meta.tileCells
    const col = Math.floor((x + t.halfExtentM) / t.cellM)
    const row = Math.floor((t.halfExtentM - y) / t.cellM)
    if (col < 0 || row < 0 || col >= t.cells || row >= t.cells) return null
    return { col, row, ty: Math.floor(row / T), tx: Math.floor(col / T), ci: col % T, cj: row % T }
  }

  async ensure(x: number, y: number, radiusM: number) {
    const T = this.meta.tileCells
    const jobs: Promise<void>[] = []
    for (const t of this.meta.tiers) {
      const c0 = Math.floor((x - radiusM + t.halfExtentM) / t.cellM)
      const c1 = Math.floor((x + radiusM + t.halfExtentM) / t.cellM)
      const r0 = Math.floor((t.halfExtentM - (y + radiusM)) / t.cellM)
      const r1 = Math.floor((t.halfExtentM - (y - radiusM)) / t.cellM)
      const lo = (v: number) => Math.max(0, Math.floor(v / T))
      for (let ty = lo(r0); ty <= Math.min(t.tilesPerSide - 1, Math.floor(r1 / T)); ty++)
        for (let tx = lo(c0); tx <= Math.min(t.tilesPerSide - 1, Math.floor(c1 / T)); tx++) {
          if (!this.have.get(t.id)!.has(`${ty}_${tx}`)) continue
          for (const [set, loader] of [['t', this.loadT], ['e', this.loadE]] as const) {
            const key = `${set}_${t.id}_${ty}_${tx}`
            if (this.cache.has(key)) continue
            this.cache.set(key, null)
            jobs.push(loader(t.id, ty, tx).then((d) => void this.cache.set(key, d)))
          }
        }
    }
    await Promise.all(jobs)
  }

  /** Finest valid cell at polar (x, y) metres. */
  cellAt(x: number, y: number): TerrainCell | null {
    const T = this.meta.tileCells
    for (const t of this.meta.tiers) {
      const p = this.tileOf(t, x, y)
      if (!p) continue
      const d = this.cache.get(`t_${t.id}_${p.ty}_${p.tx}`)
      if (!d) continue
      const o = (p.cj * T + p.ci) * 4
      if (d[o] === 255) continue
      const e = this.cache.get(`e_${t.id}_${p.ty}_${p.tx}`)
      let heightM: number | null = null
      let reliefM: number | null = null
      if (e && !(e[o] === 255 && e[o + 1] === 255)) {
        heightM = ((e[o] << 8) | e[o + 1]) * 0.5 - 10000
        reliefM = e[o + 2]
      }
      return {
        tier: t.id,
        cellM: t.cellM,
        slope100: d[o] / 2,
        roughM: d[o + 1] * 0.02,
        psrPct: d[o + 2],
        heightM,
        reliefM,
        x: -t.halfExtentM + (p.col + 0.5) * t.cellM,
        y: t.halfExtentM - (p.row + 0.5) * t.cellM,
      }
    }
    return null
  }

  /** Worst (steepest) cell and roughest cell inside a disc around (x, y). */
  zoneStats(x: number, y: number, radiusM: number, step: number) {
    let worst: TerrainCell | null = null
    let rough: TerrainCell | null = null
    let n = 0
    const k = Math.ceil(radiusM / step)
    for (let j = -k; j <= k; j++)
      for (let i = -k; i <= k; i++) {
        if (Math.hypot(i, j) * step > radiusM + step / 2) continue
        const c = this.cellAt(x + i * step, y + j * step)
        if (!c) continue
        n++
        if (!worst || c.slope100 > worst.slope100) worst = c
        if (!rough || c.roughM > rough.roughM) rough = c
      }
    return { worst, rough, n }
  }

  /** Nearest PSR cell (≥ 50 % PSR) within maxM of (x, y). */
  nearestPsr(x: number, y: number, maxM: number, step: number): PsrSearch | null {
    let best: PsrSearch | null = null
    const k = Math.ceil(maxM / step)
    for (let j = -k; j <= k; j++)
      for (let i = -k; i <= k; i++) {
        const d = Math.hypot(i, j) * step
        if (d > maxM || (best && d >= best.distM)) continue
        const c = this.cellAt(x + i * step, y + j * step)
        if (c && c.psrPct >= 50) best = { distM: d, psrPct: c.psrPct, x: x + i * step, y: y + j * step }
      }
    return best
  }

  /** Nearest 240 m Diviner bin whose maximum temperature is at or below thrK, within maxM. */
  nearestCold(x: number, y: number, maxM: number, thrK: number) {
    const g = this.science
    if (!g) return null
    const step = g.meta.pixelM
    const k = Math.ceil(maxM / step)
    let best: { distM: number; tmaxK: number; iceTableM: number | null } | null = null
    for (let j = -k; j <= k; j++)
      for (let i = -k; i <= k; i++) {
        const d = Math.hypot(i, j) * step
        if (d > maxM || (best && d >= best.distM)) continue
        const sm = g.at(x + i * step, y + j * step)
        if (sm && sm.tmaxK !== null && sm.tmaxK <= thrK) best = { distM: d, tmaxK: sm.tmaxK, iceTableM: sm.iceTableM }
      }
    return best
  }

  /** Coldest, most ice-favourable Diviner values inside a disc (240 m grid). */
  scienceStats(x: number, y: number, radiusM: number) {
    const g = this.science
    if (!g) return null
    const step = g.meta.pixelM
    const k = Math.ceil(radiusM / step)
    let tmaxMin: number | null = null
    let zitMin: number | null = null
    let f110Max: number | null = null
    let n = 0
    for (let j = -k; j <= k; j++)
      for (let i = -k; i <= k; i++) {
        if (Math.hypot(i, j) * step > radiusM + step / 2) continue
        const s = g.at(x + i * step, y + j * step)
        if (!s) continue
        n++
        if (s.tmaxK !== null && (tmaxMin === null || s.tmaxK < tmaxMin)) tmaxMin = s.tmaxK
        if (s.iceTableM !== null && (zitMin === null || s.iceTableM < zitMin)) zitMin = s.iceTableM
        const f = Math.max(s.f110Summer ?? -1, s.f110Winter ?? -1)
        if (f >= 0 && (f110Max === null || f > f110Max)) f110Max = f
      }
    return { tmaxMin, zitMin, f110Max, n }
  }
}

async function decode(blobRes: Response): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(await blobRes.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(bmp, 0, 0)
  return g.getImageData(0, 0, bmp.width, bmp.height).data
}

function tileLoader(base: string): TileLoader {
  return async (tier, ty, tx) => {
    try {
      const r = await fetch(`${base}/${tier}/${ty}_${tx}.png`)
      return r.ok ? await decode(r) : null
    } catch {
      return null
    }
  }
}

let shared: Promise<TerrainField | null> | null = null
/** Loads terrain.json, science.json and the two science images; null when the build has no terrain data. */
export function loadTerrainField(base = '/landing'): Promise<TerrainField | null> {
  shared ??= (async () => {
    try {
      const r = await fetch(`${base}/terrain.json`)
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null
      const meta = (await r.json()) as TerrainMeta
      let sci: ScienceGrid | null = null
      try {
        const sm = await fetch(`${base}/science.json`)
        if (sm.ok && (sm.headers.get('content-type') ?? '').includes('json')) {
          const [a, b] = await Promise.all([fetch(`${base}/s1.png`), fetch(`${base}/s2.png`)])
          if (a.ok && b.ok) sci = new ScienceGrid((await sm.json()) as ScienceMeta, await decode(a), await decode(b))
        }
      } catch {
        sci = null
      }
      return new TerrainField(meta, tileLoader(`${base}/t`), tileLoader(`${base}/e`), sci)
    } catch {
      return null
    }
  })()
  return shared
}
