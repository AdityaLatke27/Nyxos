import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Feature } from '../data/types'
import { dirFromLatLon, horizonAt, R_KM, siteFrame } from '../terrain/cpuTerrain'
import { skyAt, SUN_RADIUS_DEG } from '../analysis/siteAnalysis'
import { frame } from '../state/frame'
import { useSim } from '../state/store'
import { lookDir } from './StandScene'
import { haloText } from './labelText'

interface Props {
  overlay: React.RefObject<HTMLCanvasElement | null>
  features: Feature[]
  site: { lat: number; lon: number; heightKm: number } | null
  profile: Float32Array | null
}

const DEG = Math.PI / 180
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export default function StandLabels({ overlay, features, site, profile }: Props) {
  const { camera, size } = useThree()
  const startDay = useSim((s) => s.startDay)

  const landmarks = useMemo(() => {
    if (!site) return []
    const f = siteFrame(site.lat, site.lon)
    const out: { name: string; az: number; dist: number }[] = []
    for (const ft of features) {
      if (ft[4] === 'satellite' && ft[3] < 20) continue
      const p = dirFromLatLon(ft[1], ft[2])
      const c = p[0] * f.up[0] + p[1] * f.up[1] + p[2] * f.up[2]
      const dist = Math.acos(Math.min(1, c)) * R_KM
      if (dist > 320 || dist < ft[3] * 0.3) continue
      if (ft[3] < 6 + dist * 0.08) continue
      const e = p[0] * f.east[0] + p[1] * f.east[1] + p[2] * f.east[2]
      const n = p[0] * f.north[0] + p[1] * f.north[1] + p[2] * f.north[2]
      out.push({ name: ft[0], az: ((Math.atan2(e, n) / DEG) + 360) % 360, dist })
    }
    return out.sort((a, b) => a.dist - b.dist).slice(0, 40)
  }, [features, site])

  const paths = useMemo(() => {
    if (!site) return null
    const n = 30 * 24 + 1
    const sun = new Float32Array(n * 2)
    const earth = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      const s = skyAt(site.lat, site.lon, site.heightKm, startDay + i * 3.6e6)
      sun[i * 2] = s.sunAz
      sun[i * 2 + 1] = s.sunElev
      earth[i * 2] = s.earthAz
      earth[i * 2 + 1] = s.earthElev
    }
    return { sun, earth, n }
  }, [site, startDay])

  const tmp = useMemo(() => ({ v: new THREE.Vector3() }), [])

  useFrame(() => {
    const c = overlay.current
    const s = useSim.getState()
    if (!c || s.view !== 'stand' || !site) return
    const g = c.getContext('2d')!
    const W = size.width
    const H = size.height
    g.clearRect(0, 0, W, H)
    const persp = camera as THREE.PerspectiveCamera

    const proj = (az: number, el: number) => {
      lookDir(az, el, tmp.v).multiplyScalar(1000).add(persp.position)
      tmp.v.project(persp)
      if (tmp.v.z > 1) return null
      return { x: (tmp.v.x * 0.5 + 0.5) * W, y: (-tmp.v.y * 0.5 + 0.5) * H }
    }
    const hz = (az: number) => (profile ? horizonAt(profile, az) : 0)

    // 30-day paths: dotted, with a brighter dot each midnight
    if (s.showPaths && paths) {
      for (const [arr, col] of [
        [paths.sun, 'rgba(255,205,110,'],
        [paths.earth, 'rgba(120,185,255,'],
      ] as const) {
        for (let i = 0; i < paths.n; i += 2) {
          // hidden behind terrain: below the horizon at that azimuth
          if (arr[i * 2 + 1] < hz(arr[i * 2]) - 0.1) continue
          const p = proj(arr[i * 2], arr[i * 2 + 1])
          if (!p || p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) continue
          const day = i % 24 === 0
          g.fillStyle = col + (day ? '0.95)' : '0.45)')
          g.beginPath()
          g.arc(p.x, p.y, day ? 2.2 : 1.2, 0, Math.PI * 2)
          g.fill()
        }
      }
    }

    // compass on the ground just under the horizon
    g.textBaseline = 'middle'
    g.textAlign = 'center'
    g.font = '600 12px "Space Grotesk", sans-serif'
    COMPASS.forEach((label, i) => {
      const az = i * 45
      const p = proj(az, hz(az) - 1.4)
      if (!p) return
      g.fillStyle = i % 2 ? 'rgba(170,190,220,0.55)' : 'rgba(225,235,250,0.9)'
      g.fillText(label, p.x, p.y)
    })

    // landmarks along the horizon
    g.font = 'italic 11.5px "Space Grotesk", sans-serif'
    const taken: [number, number, number][] = []
    for (const lm of landmarks) {
      const p = proj(lm.az, hz(lm.az) + 0.9)
      if (!p || p.x < 0 || p.x > W) continue
      const text = `${lm.name} · ${Math.round(lm.dist)} km`
      const tw = g.measureText(text).width
      if (taken.some(([x, y, w]) => Math.abs(p.x - x) < (tw + w) / 2 + 8 && Math.abs(p.y - y) < 16)) continue
      taken.push([p.x, p.y, tw])
      haloText(g, text, p.x, p.y, 'rgba(230,236,248,0.9)')
    }

    // Sun and Earth tags
    const sky = skyAt(site.lat, site.lon, site.heightKm, frame.timeMs)
    g.font = '500 12.5px "Space Grotesk", sans-serif'
    const sunH = hz(sky.sunAz)
    const sunHidden = sky.sunElev + SUN_RADIUS_DEG < sunH
    const sunText = sunHidden
      ? sky.sunElev > -1.2
        ? 'Sun · behind the hills'
        : `Sun · ${sky.sunElev.toFixed(1)}° below the horizon`
      : 'Sun'
    const sp = proj(sky.sunAz, sunHidden ? Math.max(sunH, sky.sunElev) + 1.1 : sky.sunElev + Math.max(0.9, persp.fov * 0.045))
    if (sp) {
      g.fillStyle = 'rgba(255,196,110,0.95)'
      g.fillText(sunText, sp.x, sp.y)
    }
    const eH = hz(sky.earthAz)
    const earthHidden = sky.earthElev + sky.earthRadiusDeg < eH
    const ep = proj(sky.earthAz, Math.max(sky.earthElev, earthHidden ? eH : -90) + Math.max(sky.earthRadiusDeg * 1.6, persp.fov * 0.045))
    if (ep) {
      g.fillStyle = 'rgba(140,195,255,0.95)'
      g.fillText(earthHidden ? 'Earth · below the hills' : 'Earth', ep.x, ep.y)
    }
    g.textAlign = 'left'
  }, 2)

  return null
}
