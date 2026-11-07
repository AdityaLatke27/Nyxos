import * as THREE from 'three'
import {
  decodeHeights,
  fetchAll,
  heightTexture,
  imageTexture,
  loadMoonAssets,
  type HeightInfo,
} from '../../moon/loadMoonAssets'
import type {
  CpuGrid,
  Feature,
  PolarLevel,
  SimAssets,
  SimHeightInfo,
  SimManifest,
  SiteInfo,
  SitePatch,
  SiteTerrain,
} from './types'

const BASE = '/sim/'

type Progress = (loaded: number, total: number) => void

function asHeightInfo(i: SimHeightInfo): HeightInfo {
  return { file: i.file, width: i.size, height: i.size, hMin: i.hMin, hMax: i.hMax, source: '' }
}

function cpuFromTexture(t: THREE.DataTexture): CpuGrid {
  const m = (t.mipmaps as unknown as { data: Uint16Array; width: number; height: number }[])[0]
  return { data: m.data, w: m.width, h: m.height }
}

/** Loads everything the simulator needs, reusing the landing page's moon data. */
export async function loadSimAssets(onProgress: Progress): Promise<SimAssets> {
  let moonBytes = [0, 0]
  let simBytes = [0, 0]
  const report = () => onProgress(moonBytes[0] + simBytes[0], moonBytes[1] + simBytes[1])

  const extras = (async () => {
    const [manifest, sites, features] = await Promise.all([
      fetch(`${BASE}manifest.json`).then((r) => r.json() as Promise<SimManifest>),
      fetch(`${BASE}sites.json`).then((r) => r.json() as Promise<SiteInfo[]>),
      fetch(`${BASE}features.json`).then((r) => r.json() as Promise<Feature[]>),
    ])
    const urls = [
      BASE + manifest.poleFine.file,
      BASE + manifest.poleWide.file,
      BASE + manifest.lroPole.file,
      BASE + manifest.earth.day,
      BASE + manifest.earth.clouds,
      BASE + manifest.earth.night,
    ]
    const buffers = await fetchAll(urls, (l, t) => {
      simBytes = [l, t]
      report()
    })
    const [decoded, lro, day, clouds, night] = await Promise.all([
      decodeHeights([
        { buffer: buffers[0], info: asHeightInfo(manifest.poleFine) },
        { buffer: buffers[1], info: asHeightInfo(manifest.poleWide) },
      ]),
      imageTexture(buffers[2], true),
      imageTexture(buffers[3], true),
      imageTexture(buffers[4], false),
      imageTexture(buffers[5], true),
    ])
    lro.wrapS = THREE.ClampToEdgeWrapping
    const level = (i: number, info: SimManifest['poleFine']): PolarLevel => {
      const texture = heightTexture(decoded[i].mips, THREE.ClampToEdgeWrapping)
      return { texture, cpu: cpuFromTexture(texture), halfExtentKm: info.halfExtentKm, cellKm: info.cellKm }
    }
    return {
      manifest,
      sites,
      features,
      poleFine: level(0, manifest.poleFine),
      poleWide: level(1, manifest.poleWide),
      lroPole: lro,
      earthDay: day,
      earthClouds: clouds,
      earthNight: night,
    }
  })()

  const [moon, rest] = await Promise.all([
    loadMoonAssets((l, t) => {
      moonBytes = [l, t]
      report()
    }),
    extras,
  ])
  return { moon, ...rest }
}

const siteCache = new Map<string, Promise<SiteTerrain>>()

/** Lazily loads the high-resolution terrain patches (and orbital photo) around a site. */
export function loadSiteTerrain(site: SiteInfo): Promise<SiteTerrain> {
  const hit = siteCache.get(site.id)
  if (hit) return hit
  const p = (async () => {
    if (!site.near || !site.mid) throw new Error(`No terrain patches for ${site.name}`)
    const [nearBuf, midBuf, photoBuf] = await fetchAll(
      [BASE + site.near.file, BASE + site.mid.file, BASE + (site.photo ?? site.near.file)],
      () => {},
    )
    const [decoded, photo] = await Promise.all([
      decodeHeights([
        { buffer: nearBuf, info: asHeightInfo(site.near) },
        { buffer: midBuf, info: asHeightInfo(site.mid) },
      ]),
      site.photo ? imageTexture(photoBuf, true) : Promise.resolve(null),
    ])
    const patch = (i: number, info: NonNullable<SiteInfo['near']>): SitePatch => {
      const texture = heightTexture(decoded[i].mips, THREE.ClampToEdgeWrapping)
      return { texture, cpu: cpuFromTexture(texture), halfExtentKm: (info.size * info.cellKm) / 2, cellKm: info.cellKm }
    }
    if (photo) photo.wrapS = THREE.ClampToEdgeWrapping
    return { site, near: patch(0, site.near), mid: patch(1, site.mid), photo }
  })()
  siteCache.set(site.id, p)
  p.catch(() => siteCache.delete(site.id))
  return p
}
