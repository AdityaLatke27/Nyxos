import { useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { SimAssets } from '../data/types'
import { simTerrainFunctionsGLSL, simTerrainUniforms, simTerrainUniformsGLSL } from '../terrain/simTerrainGLSL'
import { CAP_HALF_KM } from '../scene/moonMaterials'
import { moonState } from '../../astro/ephemeris'

/**
 * "Sunlight over the 30 days" for the south polar cap.
 *  1. Horizon map: for each 600 m cell, the terrain horizon elevation toward
 *     32 azimuths (ray-marched once on the GPU, packed into a 4x2 atlas,
 *     4 azimuths per RGBA texel).
 *  2. Integration: for the chosen 30 days, average the visible fraction of
 *     the solar disc over 120 Sun positions against that horizon map.
 */

const N = 1024
const AZ = 32
const SAMPLES = 120
const EL_MIN = -8
const EL_RANGE = 32

const quadVertex = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`

const commonGLSL = /* glsl */ `
  uniform float uCapHalf;
  vec3 cellDir(vec2 uv) {
    vec2 XY = (uv - 0.5) * 2.0 * uCapHalf;
    float rho = length(XY);
    float lat = 2.0 * atan(rho / (2.0 * uRadiusKm)) - PI * 0.5;
    float lon = atan(XY.x, XY.y);
    return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  }
`

const horizonFragment = /* glsl */ `
  ${simTerrainUniformsGLSL}
  ${simTerrainFunctionsGLSL}
  ${commonGLSL}
  uniform float uTile;   // 0..7, azimuths uTile*4 .. uTile*4+3
  uniform vec2 uTileOrigin;
  void main() {
    vec2 uv = (gl_FragCoord.xy - uTileOrigin) / ${N.toFixed(1)};
    vec3 P = cellDir(uv);
    vec3 t1, t2;
    tangentBasis(P, t1, t2);
    float R = uRadiusKm;
    float h0 = heightAt(P, 0.6);
    vec4 outv;
    for (int k = 0; k < 4; k++) {
      float az = (uTile * 4.0 + float(k)) / ${AZ.toFixed(1)} * TAU;
      vec3 dir = cos(az) * t1 + sin(az) * t2;
      float best = -1.0;
      float s = 0.7;
      for (int j = 0; j < 44; j++) {
        float a = s / R;
        vec3 Q = normalize(cos(a) * P + sin(a) * dir);
        float h = heightAt(Q, max(0.6, s * 0.012));
        float sh = sin(a * 0.5);
        float vert = -(R + h) * 2.0 * sh * sh + (h - h0);
        float horiz = (R + h) * sin(a);
        best = max(best, vert / horiz);
        s *= 1.155;
      }
      float el = degrees(atan(best));
      outv[k] = clamp((el - ${EL_MIN.toFixed(1)}) / ${EL_RANGE.toFixed(1)}, 0.0, 1.0);
    }
    gl_FragColor = outv;
  }
`

const integrateFragment = /* glsl */ `
  ${simTerrainUniformsGLSL}
  ${simTerrainFunctionsGLSL}
  ${commonGLSL}
  uniform sampler2D uAtlas;
  uniform vec3 uSun[${SAMPLES}];
  float horizonAt(vec2 uv, float azIndex) {
    float i = mod(azIndex, ${AZ.toFixed(1)});
    float tile = floor(i / 4.0);
    float ch = i - tile * 4.0;
    vec2 origin = vec2(mod(tile, 4.0), floor(tile / 4.0));
    vec4 t = texture(uAtlas, (origin + uv) / vec2(4.0, 2.0));
    float v = ch < 0.5 ? t.r : ch < 1.5 ? t.g : ch < 2.5 ? t.b : t.a;
    return v * ${EL_RANGE.toFixed(1)} + ${EL_MIN.toFixed(1)};
  }
  void main() {
    vec2 uv = gl_FragCoord.xy / ${N.toFixed(1)};
    vec3 P = cellDir(uv);
    vec3 t1, t2;
    tangentBasis(P, t1, t2);
    float sum = 0.0;
    for (int k = 0; k < ${SAMPLES}; k++) {
      vec3 S = uSun[k];
      float el = degrees(asin(clamp(dot(S, P), -1.0, 1.0)));
      if (el < -7.5) continue;
      float az = atan(dot(S, t2), dot(S, t1));
      float x = (az < 0.0 ? az + TAU : az) / TAU * ${AZ.toFixed(1)};
      float f = fract(x);
      float hz = mix(horizonAt(uv, floor(x)), horizonAt(uv, floor(x) + 1.0), f);
      sum += clamp((el - hz + 0.267) / 0.533, 0.0, 1.0);
    }
    float frac = sum / ${SAMPLES.toFixed(1)};
    gl_FragColor = vec4(frac, frac, frac, 1.0);
  }
`

export interface HeatState {
  target: THREE.WebGLRenderTarget
  atlas: THREE.WebGLRenderTarget
  ready: boolean
  progress: number
}

export function useHeatmap(assets: SimAssets | null, startDay: number) {
  const target = useMemo(
    () =>
      new THREE.WebGLRenderTarget(N, N, {
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      }),
    [],
  )
  const atlas = useMemo(
    () =>
      new THREE.WebGLRenderTarget(N * 4, N * 2, {
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
      }),
    [],
  )
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0)
  return { texture: target.texture, target, atlas, ready, setReady, progress, setProgress, assets, startDay }
}

type Heat = ReturnType<typeof useHeatmap>

const frameWait = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Runs inside the Canvas: builds the horizon atlas once, re-integrates when the start day changes. */
export function HeatmapBaker({ heat }: { heat: Heat }) {
  const gl = useThree((s) => s.gl)
  const [atlasDone, setAtlasDone] = useState(false)
  const { assets, startDay } = heat

  const rig = useMemo(() => {
    if (!assets) return null
    const uniforms = { ...simTerrainUniforms(assets), uCapHalf: { value: CAP_HALF_KM } }
    const horizon = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: horizonFragment,
      uniforms: { ...uniforms, uTile: { value: 0 }, uTileOrigin: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    })
    const integrate = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: integrateFragment,
      uniforms: {
        ...uniforms,
        uAtlas: { value: heat.atlas.texture },
        uSun: { value: Array.from({ length: SAMPLES }, () => new THREE.Vector3()) },
      },
      depthTest: false,
      depthWrite: false,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), horizon)
    quad.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(quad)
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    return { horizon, integrate, quad, scene, camera }
  }, [assets, heat.atlas])

  // 1. horizon atlas, 8 tiles x strips, spread across frames
  useEffect(() => {
    if (!rig) return
    let cancelled = false
    ;(async () => {
      await frameWait()
      const prev = gl.getRenderTarget()
      const auto = gl.autoClear
      gl.autoClear = false
      const strip = 64
      const total = 8 * (N / strip)
      let done = 0
      rig.quad.material = rig.horizon
      for (let tile = 0; tile < 8 && !cancelled; tile++) {
        const ox = (tile % 4) * N
        const oy = Math.floor(tile / 4) * N
        rig.horizon.uniforms.uTile.value = tile
        rig.horizon.uniforms.uTileOrigin.value.set(ox, oy)
        for (let y = 0; y < N && !cancelled; y += strip) {
          heat.atlas.viewport.set(0, 0, N * 4, N * 2)
          heat.atlas.scissor.set(ox, oy + y, N, strip)
          heat.atlas.scissorTest = true
          gl.setRenderTarget(heat.atlas)
          gl.render(rig.scene, rig.camera)
          gl.setRenderTarget(prev)
          done++
          if (done % 4 === 0) heat.setProgress(done / total)
          await frameWait()
        }
      }
      heat.atlas.scissorTest = false
      gl.autoClear = auto
      if (!cancelled) {
        heat.setProgress(1)
        setAtlasDone(true)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rig, gl])

  // 2. integrate the chosen 30 days
  useEffect(() => {
    if (!rig || !atlasDone) return
    const suns = rig.integrate.uniforms.uSun.value as THREE.Vector3[]
    for (let k = 0; k < SAMPLES; k++) {
      const t = startDay + ((k + 0.5) / SAMPLES) * 30 * 86400000
      suns[k].set(...moonState(new Date(t)).sunDir)
    }
    const prev = gl.getRenderTarget()
    rig.quad.material = rig.integrate
    gl.setRenderTarget(heat.target)
    gl.render(rig.scene, rig.camera)
    gl.setRenderTarget(prev)
    heat.setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rig, atlasDone, startDay, gl])

  return null
}
