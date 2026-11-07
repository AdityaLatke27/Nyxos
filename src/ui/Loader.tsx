import './loader.css'

interface Props {
  stage: 'download' | 'bake' | 'ready'
  downloaded: number
  total: number
  bake: number
  error: string | null
}

const mb = (b: number) => (b / 1e6).toFixed(1)

export default function Loader({ stage, downloaded, total, bake, error }: Props) {
  const fraction = stage === 'download' ? (total ? (downloaded / total) * 0.8 : 0) : 0.8 + bake * 0.2
  const label =
    stage === 'download'
      ? `Fetching lunar elevation data · ${mb(downloaded)}${total ? ` / ${mb(total)}` : ''} MB`
      : 'Ray-tracing sunlight across the terrain'

  return (
    <div className={`loader ${stage === 'ready' ? 'loader--done' : ''}`} aria-live="polite">
      <div className="loader-inner">
        {error ? (
          <p className="loader-error">{error}</p>
        ) : (
          <>
            <div className="loader-bar">
              <span style={{ transform: `scaleX(${fraction})` }} />
            </div>
            <p className="loader-label">{label}</p>
            <p className="loader-source">NASA LRO LOLA · SLDEM2015 · LROC WAC</p>
          </>
        )}
      </div>
    </div>
  )
}
