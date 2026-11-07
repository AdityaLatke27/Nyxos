/// <reference lib="webworker" />
import { decode } from 'fast-png'

export interface HeightRequest {
  id: number
  buffer: ArrayBuffer
  hMin: number
  hMax: number
}

export interface HeightMip {
  width: number
  height: number
  data: Uint16Array // IEEE half-float bits, km above the 1737.4 km sphere
}

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)

function toHalf(v: number) {
  f32[0] = v
  const x = u32[0]
  const sign = (x >>> 16) & 0x8000
  const exp = ((x >>> 23) & 0xff) - 112
  const mant = x & 0x7fffff
  if (exp <= 0) {
    if (exp < -10) return sign
    const m = (mant | 0x800000) >> (1 - exp)
    return sign | ((m + 0x1000) >> 13)
  }
  if (exp >= 31) return sign | 0x7c00
  return (sign | (exp << 10) | (mant >> 13)) + ((mant >> 12) & 1)
}

function packHalf(src: Float32Array) {
  const out = new Uint16Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = toHalf(src[i])
  return out
}

/** 16-bit steps from either a 16-bit grey PNG or a lossless WebP holding R = high byte, G = low byte. */
async function readSteps(buffer: ArrayBuffer): Promise<{ width: number; height: number; src: Uint16Array }> {
  const b = new Uint8Array(buffer, 0, 4)
  if (b[0] !== 0x52 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x46) {
    const png = decode(new Uint8Array(buffer))
    return { width: png.width, height: png.height, src: png.data as Uint16Array }
  }
  const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/webp' }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  const { width, height } = bitmap
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const rgba = ctx.getImageData(0, 0, width, height).data
  const src = new Uint16Array(width * height)
  for (let i = 0; i < src.length; i++) src[i] = (rgba[i * 4] << 8) | rgba[i * 4 + 1]
  return { width, height, src }
}

self.onmessage = async (e: MessageEvent<HeightRequest>) => {
  const { id, buffer, hMin, hMax } = e.data
  const { width, height, src } = await readSteps(buffer)
  const k = (hMax - hMin) / 65535

  let level = new Float32Array(width * height)
  for (let i = 0; i < level.length; i++) level[i] = hMin + src[i] * k

  const mips: HeightMip[] = []
  let w = width
  let h = height
  for (;;) {
    mips.push({ width: w, height: h, data: packHalf(level) })
    if (w === 1 && h === 1) break
    const nw = Math.max(1, w >> 1)
    const nh = Math.max(1, h >> 1)
    const next = new Float32Array(nw * nh)
    for (let y = 0; y < nh; y++) {
      const y0 = Math.min(2 * y, h - 1) * w
      const y1 = Math.min(2 * y + 1, h - 1) * w
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(2 * x, w - 1)
        const x1 = Math.min(2 * x + 1, w - 1)
        next[y * nw + x] = 0.25 * (level[y0 + x0] + level[y0 + x1] + level[y1 + x0] + level[y1 + x1])
      }
    }
    level = next
    w = nw
    h = nh
  }

  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(
    { id, width, height, mips },
    mips.map((m) => m.data.buffer),
  )
}
