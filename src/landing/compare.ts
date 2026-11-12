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
  L.push(['latitude', ...results.map((r) => r.entry.lat.toFixed(4))].map(q).join(','))
  L.push(['longitude', ...results.map((r) => r.entry.lon.toFixed(4))].map(q).join(','))
  for (const k of ['safety', 'operations', 'science'] as VerdictKey[]) {
    L.push([`${VERDICT_LABEL[k]} verdict`, ...results.map((r) => r.a?.[k].status ?? 'ERROR')].map(q).join(','))
  }
  for (const m of rowList(results)) {
    L.push([`${m.label} (status${m.gating ? ', gating' : ''})`, ...results.map((r) => rowFor(r, m.id)?.status ?? '')].map(q).join(','))
    L.push([`${m.label} (value)`, ...results.map((r) => rowFor(r, m.id)?.value ?? '')].map(q).join(','))
  }
  L.push(['Answer stability', ...results.map((r) => (r.a ? ROBUSTNESS_LABEL[r.a.sensitivity.level] : ''))].map(q).join(','))
  L.push(['Windows with sunlight and Earth, next year', ...results.map((r) => (r.a ? String(r.a.windows.litAndEarth.length) : ''))].map(q).join(','))
  L.push('# No combined score is computed. Safety, Operations and Science are separate questions. Evidence of cold traps is not proof of ice.')
  return L.join('\n')
}
