import type * as THREE from 'three'
import type { MoonAssets } from '../../moon/loadMoonAssets'

export interface SimHeightInfo {
  file: string
  size: number
  hMin: number
  hMax: number
}

export interface SiteInfo {
  id: string
  name: string
  lat: number
  lon: number
  group: string
  source?: string
  near?: SimHeightInfo & { cellKm: number }
  mid?: SimHeightInfo & { cellKm: number }
  photo?: string
}

/** [name, lat, lon, diameterKm, kind] — IAU / USGS Gazetteer of Planetary Nomenclature */
export type Feature = [string, number, number, number, 'crater' | 'satellite' | 'mons' | 'mare' | 'vallis']

export interface SimManifest {
  radiusKm: number
  poleFine: SimHeightInfo & { cellKm: number; halfExtentKm: number; source: string }
  poleWide: SimHeightInfo & { cellKm: number; halfExtentKm: number; source: string }
  lroPole: { file: string; cellKm: number; halfExtentKm: number; source: string }
  earth: { day: string; clouds: string; night: string }
}

/** A height grid kept on the CPU as IEEE half floats (km above 1737.4 km). */
export interface CpuGrid {
  data: Uint16Array
  w: number
  h: number
}

export interface PolarLevel {
  texture: THREE.DataTexture
  cpu: CpuGrid
  halfExtentKm: number
  cellKm: number
}

export interface SitePatch {
  texture: THREE.DataTexture
  cpu: CpuGrid
  halfExtentKm: number
  cellKm: number
}

export interface SiteTerrain {
  site: SiteInfo
  near: SitePatch
  mid: SitePatch
  photo: THREE.Texture | null
}

export interface SimAssets {
  moon: MoonAssets
  manifest: SimManifest
  poleFine: PolarLevel
  poleWide: PolarLevel
  lroPole: THREE.Texture
  earthDay: THREE.Texture
  earthClouds: THREE.Texture
  earthNight: THREE.Texture
  features: Feature[]
  sites: SiteInfo[]
}
