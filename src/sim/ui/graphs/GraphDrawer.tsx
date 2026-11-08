import type { LatLon } from '../../../analysis/geo'
import { useSim, type GraphTab } from '../../state/store'
import type { CpuTerrain } from '../../terrain/cpuTerrain'
import type { Feature } from '../../data/types'
import DistributionTab from './DistributionTab'
import HeatmapTab from './HeatmapTab'
import ProfileTab from './ProfileTab'
import TimelineTab from './TimelineTab'

export const GRAPH_TABS: { id: GraphTab; label: string }[] = [
  { id: 'profile', label: 'Cross-section' },
  { id: 'distribution', label: 'Terrain distribution' },
  { id: 'timeline', label: 'Sunlight timeline' },
  { id: 'heatmap', label: 'Illumination heatmap' },
]

interface Props {
  terrain: CpuTerrain
  features: Feature[]
  point: LatLon | null
  hasTerrain: boolean
}

/** On-demand analysis drawer over the map; only the open graph is computed. */
export default function GraphDrawer({ terrain, features, point, hasTerrain }: Props) {
  const open = useSim((s) => s.graphOpen)
  const tab = useSim((s) => s.graphTab)
  const set = useSim((s) => s.set)
  if (!open) return null
  return (
    <section className="graph-drawer" aria-label="Analysis graphs">
      <header className="gd-head">
        <div className="gd-tabs" role="tablist">
          {GRAPH_TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`btn ${tab === t.id ? 'on' : ''}`} onClick={() => set({ graphTab: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => set({ graphOpen: false, picking: null })} aria-label="Close graphs">
          ✕
        </button>
      </header>
      {tab === 'profile' && <ProfileTab terrain={terrain} point={point} hasTerrain={hasTerrain} />}
      {tab === 'distribution' && <DistributionTab terrain={terrain} features={features} point={point} hasTerrain={hasTerrain} />}
      {tab === 'timeline' && <TimelineTab terrain={terrain} features={features} point={point} hasTerrain={hasTerrain} />}
      {tab === 'heatmap' && <HeatmapTab terrain={terrain} features={features} point={point} hasTerrain={hasTerrain} />}
    </section>
  )
}
