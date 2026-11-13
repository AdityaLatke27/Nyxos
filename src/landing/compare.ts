import type { Assessment, Row, Status, Verdict } from './engine'
import { ROBUSTNESS_LABEL } from './sensitivity'

export interface SiteEntry {
  id: string
  name: string
  lat: number
  lon: number
}
export interface CompareResult {
  entry: SiteEntry
  a: Assessment | null
  error?: string
  /** date mode: this column is the same site at another landing time */
  startMs?: number
  slipDays?: number
}

/** Sunlight and Earth access over the stay, taken from the analysis timeline (nothing is re-modelled here). */
export interface Access {
  litPct: number
  earthPct: number
  bothPct: number
  /** longest continuous run without direct sunlight; interior runs are refined to the crossing times */
  longestDarkH: number
  longestEarthOutH: number
  /** longest run with neither Sun nor Earth, counted in 30-minute samples */
  longestNeitherH: number
  /** a run touches the start or end of the stay, so its true length may be longer */
  darkClipped: boolean
  neitherClipped: boolean
}

export function accessSummary(a: Assessment): Access {
  const tl = a.timeline
  const L = Math.round((a.stayDays * 86400000) / tl.stepMs)
  const n = Math.min(tl.n, L + 1)
  let best = 0, run = 0, clipped = false
  for (let i = 0; i < n; i++) {
    if (tl.sunFrac[i] < 0.5 && tl.earthFrac[i] < 0.5) {
      run++
      if (run > best) { best = run; clipped = i === n - 1 || run === i + 1 }
    } else run = 0
  }
  return {
    litPct: a.stats.litPct,
    earthPct: a.stats.earthPct,
    bothPct: a.stats.bothPct,
    longestDarkH: a.stats.longestDarkH,
    longestEarthOutH: a.stats.longestEarthOutH,
    longestNeitherH: (best * tl.stepMs) / 3.6e6,
    darkClipped: a.stats.darkClipped,
    neitherClipped: clipped,
  }
}

export const fmtSpan = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`)

/** Rows shown in the comparison's access section, as [label, hint, value per column]. */
export function accessRows(results: CompareResult[]): { label: string; hint: string; cells: string[] }[] {
  const acc = results.map((r) => (r.a ? accessSummary(r.a) : null))
  const f = (fn: (x: Access) => string) => acc.map((x) => (x ? fn(x) : '–'))
  return [
    { label: 'Sunlit share of the stay', hint: 'at least half the Sun disc above the horizon', cells: f((x) => `${x.litPct.toFixed(1)}%`) },
    { label: 'Longest without sunlight', hint: 'sizes the battery; + means it runs past the stay', cells: f((x) => `${fmtSpan(x.longestDarkH)}${x.darkClipped && x.longestDarkH > 0 ? '+' : ''}`) },
    { label: 'Earth in view', hint: 'direct line of sight, geometry only', cells: f((x) => `${x.earthPct.toFixed(1)}%`) },
    { label: 'Longest without Earth', hint: 'longest gap in direct communication', cells: f((x) => fmtSpan(x.longestEarthOutH)) },
    { label: 'Sun and Earth both in view', hint: 'time both are available together', cells: f((x) => `${x.bothPct.toFixed(1)}%`) },
    { label: 'Longest with neither Sun nor Earth', hint: 'no power and no link at once; 30 min resolution', cells: f((x) => `${fmtSpan(x.longestNeitherH)}${x.neitherClipped && x.longestNeitherH > 0 ? '+' : ''}`) },
  ]
}

/** Landing times for date mode: the base time plus each slip in days (sorted, unique, 0 always first). */
export function slipTimes(baseMs: number, slips: number[]): { startMs: number; slipDays: number }[] {
  const u = [...new Set([0, ...slips.filter((d) => Number.isFinite(d) && d >= 0 && d <= 365)])].sort((a, b) => a - b)
  return u.map((d) => ({ startMs: baseMs + Math.round(d * 86400000), slipDays: d }))
}

export interface RowMeta {
  id: string
  label: string
  gating: boolean
}

/** Union of constraint rows across the sites, in order of first appearance, gating rows first. */
export function rowList(results: CompareResult[]): RowMeta[] {
  const seen = new Map<string, RowMeta>()
  for (const r of results) {
    for (const row of r.a?.rows ?? []) {
      if (!seen.has(row.id)) seen.set(row.id, { id: row.id, label: row.label, gating: !!row.gating })
    }
  }
  const all = [...seen.values()]
  return [...all.filter((r) => r.gating), ...all.filter((r) => !r.gating)]
}

export const rowFor = (r: CompareResult, id: string): Row | undefined => r.a?.rows.find((x) => x.id === id)

/** True when the sites do not all share one status for this row (sites without the row are ignored). */
export function rowDiffers(results: CompareResult[], id: string): boolean {
  const s = new Set(results.map((r) => rowFor(r, id)?.status).filter((x): x is Status => !!x))
  return s.size > 1
}

export type VerdictKey = 'safety' | 'operations' | 'science'
export const VERDICT_LABEL: Record<VerdictKey, string> = { safety: 'Safety', operations: 'Operations', science: 'Science' }

/**
 * One plain sentence per verdict saying which sites land in which status. Deliberately no ranking and no combined score:
 * the three questions have different answers and are never merged.
 */
export function verdictSummary(results: CompareResult[]): string[] {
  const ok = results.filter((r) => r.a)
  const out: string[] = []
  for (const k of ['safety', 'operations', 'science'] as VerdictKey[]) {
    const groups = new Map<Status, string[]>()
    for (const r of ok) {
      const v: Verdict = r.a![k]
      groups.set(v.status, [...(groups.get(v.status) ?? []), r.entry.name])
    }
    const order: Status[] = ['PASS', 'WARNING', 'FAIL', 'NOT_EVALUATED', 'INFO']
    const parts = order.filter((s) => groups.has(s)).map((s) => `${STATUS_WORD[s]}: ${groups.get(s)!.join(', ')}`)
    out.push(`${VERDICT_LABEL[k]} — ${parts.join('; ') || 'no results'}`)
  }
  return out
}
const STATUS_WORD: Record<Status, string> = { PASS: 'pass', WARNING: 'warning', FAIL: 'fail', NOT_EVALUATED: 'not evaluated', INFO: 'info' }

const q = (s: string) => `"${s.replace(/"/g, '""')}"`

export function compareCsv(results: CompareResult[], meta: { profile: string; startIso: string; stayDays: number }): string {
  const L: string[] = []
  L.push(`# NYXOS site comparison, lander profile: ${meta.profile}, landing ${meta.startIso}, stay ${meta.stayDays} d`)
  L.push(['item', ...results.map((r) => r.entry.name)].map(q).join(','))
  if (results.some((r) => r.startMs !== undefined)) L.push(['landing time (UTC)', ...results.map((r) => (r.startMs !== undefined ? new Date(r.startMs).toISOString() : ''))].map(q).join(','))
  L.push(['latitude', ...results.map((r) => r.entry.lat.toFixed(4))].map(q).join(','))
  L.push(['longitude', ...results.map((r) => r.entry.lon.toFixed(4))].map(q).join(','))
  for (const k of ['safety', 'operations', 'science'] as VerdictKey[]) {
    L.push([`${VERDICT_LABEL[k]} verdict`, ...results.map((r) => r.a?.[k].status ?? 'ERROR')].map(q).join(','))
  }
  for (const m of rowList(results)) {
    L.push([`${m.label} (status${m.gating ? ', gating' : ''})`, ...results.map((r) => rowFor(r, m.id)?.status ?? '')].map(q).join(','))
    L.push([`${m.label} (value)`, ...results.map((r) => rowFor(r, m.id)?.value ?? '')].map(q).join(','))
  }
  for (const r of accessRows(results)) L.push([r.label, ...r.cells].map(q).join(','))
  L.push(['Answer stability', ...results.map((r) => (r.a ? ROBUSTNESS_LABEL[r.a.sensitivity.level] : ''))].map(q).join(','))
  L.push(['Windows with sunlight and Earth, next year', ...results.map((r) => (r.a ? String(r.a.windows.litAndEarth.length) : ''))].map(q).join(','))
  L.push('# No combined score is computed. Safety, Operations and Science are separate questions. Evidence of cold traps is not proof of ice.')
  return L.join('\n')
}
