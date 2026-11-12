/**
 * Lander profiles: every limit the verdict uses lives here, with the source it came from.
 * Nothing in the engine hard-codes a threshold.
 */
export interface Limit<T> {
  value: T
  source: string
}

export interface LanderProfile {
  id: string
  name: string
  /** Maximum surface slope for landing, measured over `landingSlopeBaselineM`. */
  maxLandingSlopeDeg: Limit<number>
  /** Landing target / dispersion radius: the landing zone that must be safe. */
  landingZoneRadiusM: Limit<number>
  /** EVA / traverse slope limit and the radius it is judged over. */
  maxEvaSlopeDeg: Limit<number>
  evaRadiusM: Limit<number>
  /** Site must lie within this many degrees of latitude of the south pole (null = no limit). */
  southPoleBandDeg: Limit<number | null>
  /** True when the surface must be sunlit for the whole stay. */
  requireLitWholeStay: Limit<boolean>
  /** True when direct-to-Earth communication is required (no relay). */
  requireDirectEarth: Limit<boolean>
  stayDays: Limit<number>
  /** Science: how far from the site a cold trap may be and still count (traverse reach). */
  coldTrapReachM: Limit<number>
  /** Science: maximum surface temperature below which water ice is stable at the surface. */
  iceStableTempK: Limit<number>
}

const HLS_SRC = 'NASA Artemis HLS update, NTRS 20240009596 ("Key Artemis III Landing Requirements")'

export const NASA_HLS: LanderProfile = {
  id: 'nasa-hls',
  name: 'NASA HLS (Artemis III requirements)',
  maxLandingSlopeDeg: { value: 10, source: `${HLS_SRC}: surface slope for landing (100 m) < 10°` },
  landingZoneRadiusM: { value: 100, source: `${HLS_SRC}: land within 100 m of a target` },
  maxEvaSlopeDeg: { value: 20, source: `${HLS_SRC}: surface slope limit for EVA (2 km) < 20°` },
  evaRadiusM: { value: 2000, source: `${HLS_SRC}: EVA slope judged over 2 km` },
  southPoleBandDeg: { value: 6, source: `${HLS_SRC}: land within 6° latitude of the south pole` },
  requireLitWholeStay: { value: true, source: `${HLS_SRC}: surface lit for the duration of the surface stay` },
  requireDirectEarth: { value: true, source: `${HLS_SRC}: direct-with-Earth communication, no relay assumed` },
  stayDays: {
    value: 6.5,
    source: 'NYXOS assumption for the Artemis III surface stay (not stated in the NASA slides read); editable',
  },
  coldTrapReachM: { value: 10000, source: 'NYXOS assumption: traverse range within which a cold trap is still reachable for science; editable' },
  iceStableTempK: { value: 110, source: 'Diviner polar products use 110 K as the cold-trap threshold (Williams et al. 2019, JGR 124, 2505); ice is stable at the surface below about this temperature' },
}

export function customProfile(over: Partial<{ slope: number; evaSlope: number; stayDays: number; lit: boolean; earth: boolean; band: number | null }>): LanderProfile {
  const u = 'User-defined in NYXOS'
  return {
    id: 'custom',
    name: 'Custom lander',
    maxLandingSlopeDeg: { value: over.slope ?? 10, source: u },
    landingZoneRadiusM: { value: NASA_HLS.landingZoneRadiusM.value, source: u },
    maxEvaSlopeDeg: { value: over.evaSlope ?? 20, source: u },
    evaRadiusM: { value: NASA_HLS.evaRadiusM.value, source: u },
    southPoleBandDeg: { value: over.band === undefined ? null : over.band, source: u },
    requireLitWholeStay: { value: over.lit ?? false, source: u },
    requireDirectEarth: { value: over.earth ?? false, source: u },
    stayDays: { value: over.stayDays ?? 6.5, source: u },
    coldTrapReachM: NASA_HLS.coldTrapReachM,
    iceStableTempK: NASA_HLS.iceStableTempK,
  }
}
