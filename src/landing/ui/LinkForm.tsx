import { DEFAULT_LINK, LINK_SOURCE, type LinkInputs } from '../linkBudget'

const FIELDS: { key: keyof LinkInputs; label: string; step: number; min: number }[] = [
  { key: 'freqGHz', label: 'Frequency (GHz)', step: 0.1, min: 0.1 },
  { key: 'txPowerW', label: 'Transmit power (W)', step: 0.5, min: 0.001 },
  { key: 'txGainDbi', label: 'Spacecraft antenna gain (dBi)', step: 0.5, min: -10 },
  { key: 'gOverTdBK', label: 'Ground station G/T (dB/K)', step: 0.5, min: -10 },
  { key: 'dataRateKbps', label: 'Data rate (kbps)', step: 1, min: 0.01 },
  { key: 'requiredEbN0dB', label: 'Required Eb/N0 (dB)', step: 0.1, min: -5 },
  { key: 'lossesDb', label: 'Other losses (dB)', step: 0.5, min: 0 },
  { key: 'requiredMarginDb', label: 'Margin to keep (dB)', step: 0.5, min: 0 },
]

/** Editable radio-link assumptions. The result is informational and never changes a verdict. */
export default function LinkForm({ value, onChange }: { value: LinkInputs; onChange: (v: LinkInputs) => void }) {
  return (
    <details className="ld-custom">
      <summary>Link budget assumptions (informational)</summary>
      <div className="ld-two" style={{ marginTop: 8 }}>
        {FIELDS.map((f) => (
          <label key={f.key}>{f.label}
            <input type="number" step={f.step} min={f.min} value={value[f.key]} onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) onChange({ ...value, [f.key]: Math.max(f.min, v) }) }} />
          </label>
        ))}
      </div>
      <p className="ld-hint">{LINK_SOURCE} Defaults are generic placeholders.</p>
      <button type="button" className="ghost" onClick={() => onChange(DEFAULT_LINK)}>Reset to placeholders</button>
    </details>
  )
}
