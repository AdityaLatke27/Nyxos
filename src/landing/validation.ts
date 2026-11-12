/**
 * Measured agreement between the NYXOS illumination model and NASA's published average-illumination maps
 * (Mazarico et al., PGDA "Lunar Polar Illumination": AVGVISIB_85S_060M and AVGVISIB_75S_120M, plus the _EARTH maps,
 * hourly steps averaged over an 18.6 year nutation cycle).
 * Reproduce with tools/validation/*: 800 random points (400 in 85–90°S, 400 in 75–85°S), NYXOS global terrain pyramid,
 * DE440 ephemeris, 30 min steps over 2027-01-01 to 2029-12-31, compared with the NASA map value at each point.
 * Errors are in fraction of time (0.01 = one percentage point of the time lit / visible).
 */
export interface ValidationStat { bias: number; rmse: number; mae: number; p95: number; r: number }
export const ILLUMINATION_VALIDATION = {
  n: 800,
  model: '2027–2029, 30 min steps, NYXOS terrain pyramid, DE440',
  reference: 'NASA/PGDA AVGVISIB maps (LOLA, 60 m and 120 m), 18.6 yr hourly average',
  /** mean fraction of the Sun's disc above the horizon vs the NASA Sun map */
  sun: { bias: 0.0022, rmse: 0.0329, mae: 0.0160, p95: 0.0511, r: 0.977 } as ValidationStat,
  /** fraction of time any part of the Earth's disc is visible vs the NASA Earth map (NASA counts any visible part) */
  earthAny: { bias: 0.0175, rmse: 0.0436, mae: 0.0202, p95: 0.0911, r: 0.992 } as ValidationStat,
  /** fraction of time at least half of the Earth's disc is visible (the NYXOS verdict criterion) vs the same map */
  earthHalf: { bias: -0.0186, rmse: 0.0474, mae: 0.0285, p95: 0.1057, r: 0.990 } as ValidationStat,
}
/**
 * Consistency check against the Wueller et al. (2026, JGR Planets, doi 10.1029/2025JE009434) published table of the
 * longest run of days with more than half of the Sun lit (Lunar QuickMap TerrainShadows, 12 h steps) at 130 Artemis
 * candidate sites, midsummers 2026–2032 (Zenodo 10.5281/zenodo.17084058). The paper's midsummer window start and the
 * DEM are not stated in the public materials, so the window start was fitted per year (window length = the largest
 * published value of that year). That makes this a consistency check, not an independent pass/fail benchmark.
 * Reproduce with tools/validation/validate_wueller.cjs and wueller_sites.csv.
 */
export const WUELLER_CONSISTENCY = {
  sites: 130, years: '2026–2032', pairs: 910,
  spearman: 0.71, maeDays: 3.4, within3Days: 0.69, within1Day: 0.53, biasDays: 2.5,
}
const pp = (v: number) => `${(Math.abs(v) * 100).toFixed(1)} percentage points`
export function validationSentence(): string {
  const v = ILLUMINATION_VALIDATION
  return `Against NASA's published average-illumination maps at ${v.n} random points poleward of 75°S, the modelled Sun-visible fraction differs by ${pp(v.sun.rmse)} RMS (bias ${v.sun.bias >= 0 ? '+' : '−'}${pp(v.sun.bias)}, 95% of points within ${pp(v.sun.p95)}, correlation ${v.sun.r.toFixed(3)}); Earth visibility, counted as NASA counts it (any part of the disc), differs by ${pp(v.earthAny.rmse)} RMS (bias +${pp(v.earthAny.bias)}, correlation ${v.earthAny.r.toFixed(3)}). Most of the remaining difference comes from the coarser terrain model and from comparing three years with NASA's 18.6-year average. As a second, weaker check, the longest run of days with more than half the Sun lit at the 130 Artemis candidate sites of Wueller et al. (2026) agrees in rank (Spearman ${WUELLER_CONSISTENCY.spearman.toFixed(2)}) and to within 3 days for ${Math.round(WUELLER_CONSISTENCY.within3Days * 100)}% of ${WUELLER_CONSISTENCY.pairs} site-years (mean absolute difference ${WUELLER_CONSISTENCY.maeDays} days, NYXOS ${WUELLER_CONSISTENCY.biasDays} days longer on average); the paper does not publish its window or DEM, so the window start was fitted and this is a consistency check only.`
}
