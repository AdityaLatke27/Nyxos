/** Small statistics helpers. Non-finite values are dropped, never treated as zero. */

export interface Summary {
  n: number
  min: number
  max: number
  mean: number
  median: number
  std: number
  p5: number
  p95: number
}

function quantileSorted(sorted: Float64Array, q: number) {
  const x = q * (sorted.length - 1)
  const i = Math.floor(x)
  const f = x - i
  return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i]
}

/** Summary statistics, or null when there is no finite value. */
export function summarize(values: ArrayLike<number>): Summary | null {
  const kept: number[] = []
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) kept.push(values[i])
  const n = kept.length
  if (n === 0) return null
  const sorted = Float64Array.from(kept).sort()
  let sum = 0
  for (const v of kept) sum += v
  const mean = sum / n
  let ss = 0
  for (const v of kept) ss += (v - mean) * (v - mean)
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: quantileSorted(sorted, 0.5),
    std: Math.sqrt(ss / n),
    p5: quantileSorted(sorted, 0.05),
    p95: quantileSorted(sorted, 0.95),
  }
}

export interface Histogram {
  /** bins + 1 ascending edges */
  edges: number[]
  counts: number[]
  /** finite values counted (those outside an explicit range are excluded) */
  n: number
}

/** Fixed-width histogram. With no explicit range the data's min..max is used. */
export function histogram(values: ArrayLike<number>, bins: number, range?: [number, number]): Histogram {
  let lo = Infinity
  let hi = -Infinity
  if (range) [lo, hi] = range
  else {
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (!Number.isFinite(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { edges: [], counts: [], n: 0 }
  if (hi === lo) hi = lo + 1
  const w = (hi - lo) / bins
  const counts = new Array<number>(bins).fill(0)
  let n = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v) || v < lo || v > hi) continue
    counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++
    n++
  }
  return { edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * w), counts, n }
}
