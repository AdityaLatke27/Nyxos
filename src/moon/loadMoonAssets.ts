import * as THREE from 'three'
import type { HeightMip, HeightRequest } from './heightWorker'

export interface HeightInfo {
  file: string
  width: number
  height: number
  hMin: number
  hMax: number
  source: string
}

export interface PatchInfo extends HeightInfo {
  ppd: number
  latCenter: number
  lonCenter: number
  extentDeg: number
}

export interface Manifest {
  radiusKm: number
  global: HeightInfo
  patches: PatchInfo[]
  color: { '8k': string; '4k': string }
  stars: { '8k': string; '4k': string }
}

export interface HeightLevel {
  texture: THREE.DataTexture
  /** (latCenter, lonCenter, halfExtent) in radians, texel size in km */
  info: THREE.Vector4
  width: number
  height: number
  texelKm: number
}

export interface MoonAssets {
  manifest: Manifest
  color: THREE.Texture
  stars: THREE.Texture
  global: HeightLevel
  patches: HeightLevel[] // fine -> coarse: l0, l1, l2
  bytes: number
}

export type Progress = (loaded: number, total: number) => void

const BASE = '/moon/'
const DEG = Math.PI / 180

export function pickResolution(): '8k' | '4k' {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    const max = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 4096
    const smallScreen = Math.min(window.screen.width, window.screen.height) < 820
    const lowMemory = ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) < 4
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return max >= 8192 && !smallScreen && !lowMemory ? '8k' : '4k'
  } catch {
    return '4k'
  }
}

/** Fetches several files concurrently while reporting combined byte progress. */
export async function fetchAll(urls: string[], onProgress: Progress): Promise<ArrayBuffer[]> {
  const loaded = new Array(urls.length).fill(0)
  const totals = new Array(urls.length).fill(0)
  const report = () =>
    onProgress(
      loaded.reduce((a, b) => a + b, 0),
      totals.reduce((a, b) => a + b, 0),
    )

  return Promise.all(
    urls.map(async (url, i) => {
      const res = await fetch(url)
      if (!res.ok || !res.body) throw new Error(`Failed to load ${url} (${res.status})`)
      totals[i] = Number(res.headers.get('content-length')) || 0
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded[i] += value.length
        if (loaded[i] > totals[i]) totals[i] = loaded[i]
        report()
      }
      const out = new Uint8Array(loaded[i])
      let o = 0
      for (const c of chunks) {
        out.set(c, o)
        o += c.length
      }
      return out.buffer
    }),
  )
}

export function decodeHeights(buffers: { buffer: ArrayBuffer; info: HeightInfo }[]) {
  const worker = new Worker(new URL('./heightWorker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<number, (m: { width: number; height: number; mips: HeightMip[] }) => void>()
  worker.onmessage = (e) => {
    pending.get(e.data.id)?.(e.data)
    pending.delete(e.data.id)
  }
  return Promise.all(
    buffers.map(
      ({ buffer, info }, id) =>
        new Promise<{ width: number; height: number; mips: HeightMip[] }>((resolve) => {
          pending.set(id, resolve)
          const req: HeightRequest = { id, buffer, hMin: info.hMin, hMax: info.hMax }
          worker.postMessage(req, [buffer])
        }),
    ),
  ).finally(() => worker.terminate())
}

export function heightTexture(mips: HeightMip[], wrapS: THREE.Wrapping) {
  const base = mips[0]
  const tex = new THREE.DataTexture(base.data, base.width, base.height, THREE.RedFormat, THREE.HalfFloatType)
  tex.internalFormat = 'R16F'
  tex.mipmaps = mips.map((m) => ({ data: m.data, width: m.width, height: m.height })) as unknown as THREE.DataTexture['mipmaps']
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = wrapS
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.flipY = false
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

export async function imageTexture(buffer: ArrayBuffer, srgb: boolean) {
  const bitmap = await createImageBitmap(new Blob([buffer]), {
    imageOrientation: 'flipY',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  })
  const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement)
  tex.flipY = false
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = 8
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

export async function loadMoonAssets(onProgress: Progress): Promise<MoonAssets> {
  const manifest: Manifest = await (await fetch(`${BASE}manifest.json`)).json()
  const res = pickResolution()

  const heightInfos: HeightInfo[] = [manifest.global, ...manifest.patches]
  const urls = [
    ...heightInfos.map((h) => BASE + h.file),
    BASE + manifest.color[res],
    BASE + manifest.stars[res],
  ]
  const buffers = await fetchAll(urls, onProgress)
  const bytes = buffers.reduce((a, b) => a + b.byteLength, 0)

  const [decoded, color, stars] = await Promise.all([
    decodeHeights(heightInfos.map((info, i) => ({ buffer: buffers[i], info }))),
    imageTexture(buffers[heightInfos.length], true),
    imageTexture(buffers[heightInfos.length + 1], true),
  ])

  const R = manifest.radiusKm
  const g = decoded[0]
  const global: HeightLevel = {
    texture: heightTexture(g.mips, THREE.RepeatWrapping),
    info: new THREE.Vector4(0, 0, Math.PI, (2 * Math.PI * R) / g.width),
    width: g.width,
    height: g.height,
    texelKm: (2 * Math.PI * R) / g.width,
  }
  const patches = manifest.patches.map((p, i): HeightLevel => {
    const d = decoded[i + 1]
    const texelKm = (DEG / p.ppd) * R
    return {
      texture: heightTexture(d.mips, THREE.ClampToEdgeWrapping),
      info: new THREE.Vector4(p.latCenter * DEG, p.lonCenter * DEG, (p.extentDeg / 2) * DEG, texelKm),
      width: d.width,
      height: d.height,
      texelKm,
    }
  })

  return { manifest, color, stars, global, patches, bytes }
}
