import { create } from 'zustand'
import type { LatLon } from '../../analysis/geo'

export type View = 'globe' | 'pole' | 'stand'
export type Layer = 'sun' | 'earth' | 'link' | 'heat' | 'photo'
export type StandAim = 'wide' | 'sun' | 'earth'
export type Lighting = 'soft' | 'balanced' | 'strong'

/** Light & shadow presets (artistic; Strong = physically lit only). `compress` eases the
 *  glare of sun-facing slopes toward the mid-tones; `fill` is a soft overhead light, as a
 *  share of full sunlight, that keeps shadowed ground readable. */
export const LIGHTING: Record<Lighting, { fill: number; compress: number }> = {
  soft: { fill: 0.06, compress: 2.5 },
  balanced: { fill: 0.025, compress: 1 },
  strong: { fill: 0, compress: 0 },
}

export type GraphTab = 'profile' | 'distribution' | 'timeline' | 'heatmap'
export type RegionKind = 'whole' | 'floor' | 'wall' | 'rim' | 'outside' | 'around'

export const WINDOW_HOURS = 30 * 24
export const SPEEDS = [
  { label: '1 h/s', hoursPerSecond: 1 },
  { label: '6 h/s', hoursPerSecond: 6 },
  { label: '1 day/s', hoursPerSecond: 24 },
]

export const utcMidnight = (ms: number) => {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export interface PickedPoint {
  lat: number
  lon: number
}

interface SimState {
  view: View
  /** selected site id, or 'picked' for a clicked map point */
  siteId: string
  picked: PickedPoint | null
  startDay: number
  offsetHours: number
  playing: boolean
  speed: number
  live: boolean
  layer: Layer
  heightScale: 1 | 2 | 4
  lighting: Lighting
  showPaths: boolean
  showCraters: boolean
  showHaze: boolean
  aim: StandAim
  showPhoto: boolean

  // ---- analysis graphs
  graphOpen: boolean
  graphTab: GraphTab
  /** cross-section: through the selected point along a bearing, or between two clicked points */
  profileMode: 'bearing' | 'points'
  bearingDeg: number
  halfLengthKm: number
  lineA: LatLon | null
  lineB: LatLon | null
  /** which end the next map click sets in two-point mode */
  picking: 'a' | 'b' | null
  /** line and disc currently analysed, drawn on the map */
  transectLine: { a: LatLon; b: LatLon } | null
  regionDisc: { center: LatLon; radiusKm: number } | null
  /** point under the cursor on a chart, shown on the terrain */
  probe: LatLon | null
  /** analysis region: a crater zone (inside a catalogued crater) or a disc around the selected point */
  regionKind: RegionKind
  regionKm: number
  pinned: LatLon[]
  heatMode: 'groups' | 'line'
  timelineGroup: string

  setView: (v: View) => void
  selectSite: (id: string) => void
  pick: (p: PickedPoint) => void
  setStartDay: (ms: number) => void
  setOffsetHours: (h: number) => void
  togglePlay: () => void
  setSpeed: (hps: number) => void
  goNow: () => void
  toggleLive: () => void
  setLayer: (l: Layer) => void
  setHeightScale: (s: 1 | 2 | 4) => void
  set: (patch: Partial<SimState>) => void
}

const params = new URLSearchParams(window.location.search)
const initialSite = params.get('site') ?? 'im2'
const urlTime = params.get('t') ? Date.parse(params.get('t')!) : NaN
const now = Number.isNaN(urlTime) ? Date.now() : urlTime
const urlView = params.get('view')

export const useSim = create<SimState>((set, get) => ({
  view: urlView === 'stand' || urlView === 'globe' ? urlView : 'pole',
  siteId: initialSite,
  picked: null,
  startDay: utcMidnight(now),
  offsetHours: (now - utcMidnight(now)) / 3.6e6,
  playing: false,
  speed: 6,
  live: Number.isNaN(urlTime),
  layer: 'sun',
  heightScale: 4,
  lighting: 'soft',
  showPaths: true,
  showCraters: true,
  showHaze: true,
  aim: 'wide',
  showPhoto: false,

  graphOpen: false,
  graphTab: 'profile',
  profileMode: 'bearing',
  bearingDeg: 90,
  halfLengthKm: 10,
  lineA: null,
  lineB: null,
  picking: null,
  transectLine: null,
  regionDisc: null,
  probe: null,
  regionKind: 'whole',
  regionKm: 3,
  pinned: [],
  heatMode: 'groups',
  timelineGroup: 'point',

  setView: (view) => set({ view, aim: 'wide', showPhoto: false }),
  selectSite: (siteId) => {
    set({ siteId })
    const url = new URL(window.location.href)
    url.searchParams.set('site', siteId)
    window.history.replaceState(null, '', url)
  },
  pick: (picked) => set({ picked, siteId: 'picked' }),
  setStartDay: (startDay) => set({ startDay, live: false }),
  setOffsetHours: (offsetHours) =>
    set({ offsetHours: Math.min(WINDOW_HOURS, Math.max(0, offsetHours)), live: false }),
  togglePlay: () => {
    const s = get()
    if (s.playing) return set({ playing: false })
    set({ playing: true, live: false, offsetHours: s.offsetHours >= WINDOW_HOURS ? 0 : s.offsetHours })
  },
  setSpeed: (speed) => set({ speed }),
  goNow: () => {
    const t = Date.now()
    set({ startDay: utcMidnight(t), offsetHours: (t - utcMidnight(t)) / 3.6e6, playing: false })
  },
  toggleLive: () => {
    const s = get()
    if (s.live) return set({ live: false })
    const t = Date.now()
    set({ live: true, playing: false, startDay: utcMidnight(t), offsetHours: (t - utcMidnight(t)) / 3.6e6 })
  },
  setLayer: (layer) => set({ layer }),
  setHeightScale: (heightScale) => set({ heightScale }),
  set: (patch) => set(patch),
}))
