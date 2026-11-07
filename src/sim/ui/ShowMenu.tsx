import { useEffect, useRef, useState } from 'react'
import { useSim, type Layer, type Lighting } from '../state/store'

const LAYERS: { id: Layer; label: string }[] = [
  { id: 'sun', label: 'Sunlight now' },
  { id: 'earth', label: 'Earth in view' },
  { id: 'link', label: 'Sunlight + link to Earth' },
  { id: 'heat', label: 'Sunlight over the 30 days' },
  { id: 'photo', label: 'LRO photo (WAC mosaic)' },
]

/** Bottom-right menu holding the display options and the stand-view controls. */
export default function ShowMenu() {
  const s = useSim()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const standing = s.view === 'stand'

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="show-menu" ref={root}>
      {open && (
        <div className="show-menu-card" id="show-menu-card" role="dialog" aria-label="Display options">
          {standing && (
            <section>
              <h2>View</h2>
              <button className={`btn wide ${s.showPhoto ? 'on' : ''}`} onClick={() => s.set({ showPhoto: !s.showPhoto })}>
                Photo from orbit
              </button>
              <div className="row">
                <button className={`btn ${s.aim === 'sun' ? 'on' : ''}`} onClick={() => s.set({ aim: 'sun' })}>
                  Zoom to Sun
                </button>
                <button className={`btn ${s.aim === 'earth' ? 'on' : ''}`} onClick={() => s.set({ aim: 'earth' })}>
                  Zoom to Earth
                </button>
                <button className={`btn ${s.aim === 'wide' ? 'on' : ''}`} onClick={() => s.set({ aim: 'wide' })}>
                  Wide
                </button>
              </div>
              <p className="note">
                True sizes: the Sun is 0.53° across and Earth about 1.9°. Zoom in to see them as an eye with binoculars
                would. Drag to look around.
              </p>
            </section>
          )}

          <section>
            <h2>Show</h2>
            <label className="field">
              <span>South-pole layer</span>
              <select value={s.layer} onChange={(e) => s.setLayer(e.target.value as Layer)}>
                {LAYERS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Heights</span>
              <select value={s.heightScale} onChange={(e) => s.setHeightScale(Number(e.target.value) as 1 | 2 | 4)}>
                <option value={1}>×1 (true)</option>
                <option value={2}>×2</option>
                <option value={4}>×4</option>
              </select>
            </label>
            <label className="field">
              <span>Light &amp; shadow</span>
              <select value={s.lighting} onChange={(e) => s.set({ lighting: e.target.value as Lighting })}>
                <option value="soft">Soft (easy to read)</option>
                <option value="balanced">Balanced</option>
                <option value="strong">Strong (true sunlight)</option>
              </select>
            </label>
            {s.lighting !== 'strong' && (
              <p className="note">
                Adds a soft overhead fill light so shadowed ground and names stay readable. Choose Strong for true
                sunlight only.
              </p>
            )}
            <label className="check">
              <input type="checkbox" checked={s.showPaths} onChange={(e) => s.set({ showPaths: e.target.checked })} />
              Sun and Earth paths (30 days)
            </label>
            <label className="check">
              <input type="checkbox" checked={s.showCraters} onChange={(e) => s.set({ showCraters: e.target.checked })} />
              Crater names
            </label>
            <label className="check">
              <input type="checkbox" checked={s.showHaze} onChange={(e) => s.set({ showHaze: e.target.checked })} />
              Volumetric haze &amp; light shafts <em>(artistic — no real atmosphere)</em>
            </label>
          </section>

          <footer className="credits">
            Terrain: NASA LRO LOLA (20 m–2.7 km) and SLDEM2015 (LOLA + SELENE). Photos: LRO WAC global mosaic,
            NASA/GSFC/Arizona State University, via NASA Moon Trek. Color: LROC WAC. Stars: NASA SVS (Gaia, Hipparcos,
            Tycho). Crater names: IAU / USGS Gazetteer. Earth: Solar System Scope (CC BY 4.0), from NASA imagery.
            Ephemeris: Meeus + IAU WGCCRE lunar orientation. Power assumes a vertical sun-tracking array.
          </footer>
        </div>
      )}
      <button
        className={`show-menu-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close display options' : 'Display options'}
        aria-expanded={open}
        aria-controls="show-menu-card"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          {open ? (
            <path d="M5 5l10 10M15 5L5 15" />
          ) : (
            <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
          )}
        </svg>
      </button>
    </div>
  )
}
