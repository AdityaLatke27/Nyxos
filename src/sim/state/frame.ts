import * as THREE from 'three'
import { moonState } from '../../astro/ephemeris'
import { useSim, utcMidnight, WINDOW_HOURS } from './store'

/**
 * Per-frame simulation state, written once per frame by tickClock and read by
 * every shader / overlay. Kept outside React so animation never re-renders UI.
 */
export const frame = {
  timeMs: Date.now(),
  sunDir: new THREE.Vector3(1, 0, 0),
  earthDir: new THREE.Vector3(0, 0, 1),
  earthDistKm: 384400,
  earthLit: 0.5,
  icrfToScene: new THREE.Matrix3(),
  sceneToIcrf: new THREE.Matrix3(),
}

let runOffset = useSim.getState().offsetHours
let lastWrite = 0

export function updateAstro(timeMs: number) {
  const s = moonState(new Date(timeMs))
  frame.timeMs = timeMs
  frame.sunDir.set(...s.sunDir)
  frame.earthDir.set(...s.earthDir)
  frame.earthDistKm = s.earthDistKm
  frame.earthLit = s.earthIlluminated
  const [r0, r1, r2] = s.icrfToScene
  frame.icrfToScene.set(r0[0], r0[1], r0[2], r1[0], r1[1], r1[2], r2[0], r2[1], r2[2])
  frame.sceneToIcrf.copy(frame.icrfToScene).transpose()
}

export function tickClock(dtSec: number) {
  const s = useSim.getState()
  const nowMs = performance.now()
  if (s.live) {
    const t = Date.now()
    let start = s.startDay
    if ((t - start) / 3.6e6 > WINDOW_HOURS) {
      start = utcMidnight(t)
      s.set({ startDay: start })
    }
    runOffset = (t - start) / 3.6e6
  } else if (s.playing) {
    runOffset += s.speed * Math.min(dtSec, 0.1)
    if (runOffset >= WINDOW_HOURS) {
      runOffset = WINDOW_HOURS
      s.set({ playing: false, offsetHours: runOffset })
    }
  } else {
    runOffset = s.offsetHours
  }
  // Live time is shown to the minute, so a once-a-second write is invisible; playback keeps the smoother 120 ms rate.
  if ((s.live || s.playing) && nowMs - lastWrite > (s.live ? 1000 : 120)) {
    lastWrite = nowMs
    s.set({ offsetHours: runOffset })
  }
  updateAstro(s.startDay + runOffset * 3.6e6)
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const p2 = (n: number) => String(n).padStart(2, '0')

export function fmtUtc(ms: number, seconds = false) {
  const d = new Date(ms)
  const time = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${seconds ? ':' + p2(d.getUTCSeconds()) : ''}`
  return `${WEEKDAY[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${time} UTC`
}

export function fmtDuration(hours: number) {
  if (!isFinite(hours)) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 48) return `${hours.toFixed(1)} h`
  return `${(hours / 24).toFixed(1)} days`
}

export const fmtLat = (d: number) => `${Math.abs(d).toFixed(2)}°${d >= 0 ? 'N' : 'S'}`
export const fmtLon = (d: number) => `${Math.abs(d).toFixed(2)}°${d >= 0 ? 'E' : 'W'}`
