import * as THREE from 'three'
import { moonState, nextSunriseElevation, sunElevationDeg, type Vec3 } from './ephemeris'

/** Target: low morning Sun over the near-side center, long but readable shadows. */
export const SITE = { name: 'Sinus Medii', latDeg: 0, lonDeg: 0 }
export const TARGET_SUN_ELEVATION_DEG = 6

export interface Lighting {
  date: Date
  sunDir: THREE.Vector3
  earthDir: THREE.Vector3
  earthIlluminated: number
  icrfToScene: [Vec3, Vec3, Vec3]
  subsolarLatDeg: number
  subsolarLonDeg: number
  siteSunElevationDeg: number
}

export function computeLighting(now = new Date()): Lighting {
  const date = nextSunriseElevation(now, SITE.latDeg, SITE.lonDeg, TARGET_SUN_ELEVATION_DEG)
  const s = moonState(date)
  return {
    date,
    sunDir: new THREE.Vector3(...s.sunDir),
    earthDir: new THREE.Vector3(...s.earthDir),
    earthIlluminated: s.earthIlluminated,
    icrfToScene: s.icrfToScene,
    subsolarLatDeg: s.subsolarLatDeg,
    subsolarLonDeg: s.subsolarLonDeg,
    siteSunElevationDeg: sunElevationDeg(date, SITE.latDeg, SITE.lonDeg),
  }
}
