import { ARRAY_LABEL, DEFAULT_POWER, POWER_SOURCE, type ArrayType, type PowerInputs } from '../power'

const NUM: { key: 'arrayPeakW' | 'batteryWh' | 'loadW'; label: string; step: number; min: number }[] = [
  { key: 'arrayPeakW', label: 'Array peak power (W)', step: 50, min: 1 },
  { key: 'batteryWh', label: 'Usable battery (Wh)', step: 100, min: 0 },
  { key: 'loadW', label: 'Constant load (W)', step: 10, min: 0 },
]

/** Editable solar array and battery assumptions. The result is informational and never changes a verdict. */
export default function PowerForm({ value, onChange }: { value: PowerInputs; onChange: (v: PowerInputs) => void }) {
  return (
    <details className="ld-custom">
      <summary>Power and battery assumptions (informational)</summary>
      <div className="ld-two" style={{ marginTop: 8 }}>
        <label>Solar array
          <select value={value.arrayType} onChange={(e) => onChange({ ...value, arrayType: e.target.value as ArrayType })}>
            {(Object.keys(ARRAY_LABEL) as ArrayType[]).map((k) => <option key={k} value={k}>{ARRAY_LABEL[k]}</option>)}
          </select>
        </label>
        {NUM.map((f) => (
          <label key={f.key}>{f.label}
            <input type="number" step={f.step} min={f.min} value={value[f.key]} onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) onChange({ ...value, [f.key]: Math.max(f.min, v) }) }} />
          </label>
        ))}
      </div>
      <p className="ld-hint">{POWER_SOURCE} Near the pole the Sun stays within a few degrees of the horizon, so a flat array collects very little. The battery starts full at landing.</p>
      <button type="button" className="ghost" onClick={() => onChange(DEFAULT_POWER)}>Reset to placeholders</button>
    </details>
  )
}
