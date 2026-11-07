/**
 * Mutable animation state shared by the GSAP timeline (writer) and the R3F
 * frame loop (reader). Plain numbers on purpose: nothing here goes through
 * React state, so the 60 fps animation never triggers re-renders.
 */

export const MOON_RADIUS_KM = 1737.4
export const FOV_DEG = 40
export const START_ALTITUDE_KM = 74

export const intro = {
  /** camera altitude above the 1737.4 km sphere, in moon radii; camera sits on +Z */
  altitude: START_ALTITUDE_KM / MOON_RADIUS_KM,
  /** auto-exposure: the low-sun close-up needs more light than the disc */
  exposure: 2.4,
  /** earthshine multiplier: strong while the moon is the logo's "O", subtle in the hero */
  earthshine: 1,
  dust: 1,
  logo: {
    opacity: 0,
    /** 0 = centered and hugging the moon, 1 = small in the top-left corner */
    settle: 0,
    /** 0 = gap sized to the moon, 1 = gap sized to a real "O" glyph */
    oMix: 0,
    oOpacity: 0,
    tagline: 0,
  },
  controlsEnabled: false,
}

const halfFov = (FOV_DEG * Math.PI) / 360

/** Exact projected radius (px) of a unit sphere's silhouette for an on-axis camera. */
export function moonRadiusPx(distance: number, viewportH: number) {
  const alpha = Math.asin(Math.min(1 / distance, 1))
  return (Math.tan(alpha) / Math.tan(halfFov)) * (viewportH / 2)
}

/** Inverse of moonRadiusPx. */
export function distanceForRadiusPx(radiusPx: number, viewportH: number) {
  const tanAlpha = (radiusPx / (viewportH / 2)) * Math.tan(halfFov)
  return 1 / Math.sin(Math.atan(tanAlpha))
}
