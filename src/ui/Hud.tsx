import { forwardRef } from 'react'
import type { Lighting } from '../astro/lighting'
import { SITE } from '../astro/lighting'
import './hud.css'

const fmtLat = (d: number) => `${Math.abs(d).toFixed(2)}°${d >= 0 ? 'N' : 'S'}`
const fmtLon = (d: number) => `${Math.abs(d).toFixed(2)}°${d >= 0 ? 'E' : 'W'}`

const Hud = forwardRef<HTMLDivElement, { lighting: Lighting }>(function Hud({ lighting }, ref) {
  const when = lighting.date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  return (
    <div className="hud" ref={ref}>
      <dl className="hud-grid">
        <dt>Sunlight for</dt>
        <dd>{when}</dd>
        <dt>Sun at {SITE.name}</dt>
        <dd>{lighting.siteSunElevationDeg.toFixed(1)}° above horizon · rising</dd>
        <dt>Sub-solar point</dt>
        <dd>
          {fmtLat(lighting.subsolarLatDeg)} {fmtLon(lighting.subsolarLonDeg)}
        </dd>
        <dt>Earth from Moon</dt>
        <dd>{Math.round(lighting.earthIlluminated * 100)}% lit</dd>
      </dl>
      <p className="hud-credit">
        Elevation NASA LRO LOLA &amp; SLDEM2015 (LOLA + SELENE) · Color LROC WAC · Stars NASA SVS
        (Gaia, Hipparcos, Tycho) · True relief, no exaggeration
      </p>
    </div>
  )
})

export default Hud
