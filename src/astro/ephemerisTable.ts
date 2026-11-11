import { installEphemerisTable } from './ephemeris'

let loading: Promise<boolean> | null = null

/** Fetch the DE440 table once; resolves true when installed. Safe to call repeatedly. */
export function loadEphemerisTable(base = '/landing'): Promise<boolean> {
  if (loading) return loading
  loading = (async () => {
    try {
      const [mr, br] = await Promise.all([fetch(`${base}/eph.json`), fetch(`${base}/eph.f32`)])
      if (!mr.ok || !br.ok) return false
      const meta = await mr.json()
      const buf = await br.arrayBuffer()
      if (buf.byteLength !== meta.count * meta.floatsPerSample * 4) return false
      installEphemerisTable({
        startMs: Date.parse(meta.epochUtc),
        stepMs: meta.stepSeconds * 1000,
        count: meta.count,
        data: new Float32Array(buf),
      })
      return true
    } catch {
      return false
    }
  })()
  return loading
}
