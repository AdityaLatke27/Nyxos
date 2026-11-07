import * as THREE from 'three'
import type { SimAssets, SiteTerrain } from '../data/types'

/**
 * GLSL height pyramid for the simulator. Levels (coarse -> fine):
 *   global LOLA (2.67 km) -> near-side SLDEM/LOLA patches (948/237/59 m)
 *   global LOLA           -> south polar LOLA (400 m, 100 m, stereographic)
 *   any                   -> site patches (240/120 m mid, 60/20 m near; tangent plane, stand view)
 * Finer levels fade in only where they cover the point and while the requested
 * footprint is below the next-coarser texel.
 */

export const simTerrainUniformsGLSL = /* glsl */ `
  #define PI 3.141592653589793
  #define TAU 6.283185307179586
  #define DEG 0.017453292519943295
  uniform float uRadiusKm;
  uniform sampler2D uGlobalH;
  uniform float uGlobalTexel;
  uniform sampler2D uL0H;
  uniform sampler2D uL1H;
  uniform sampler2D uL2H;
  uniform vec4 uL0Info;
  uniform vec4 uL1Info;
  uniform vec4 uL2Info;
  uniform sampler2D uPWH;
  uniform sampler2D uPFH;
  uniform vec2 uPW;  // (halfExtentKm, cellKm)
  uniform vec2 uPF;
  uniform float uHasSite;
  uniform sampler2D uNearH;
  uniform sampler2D uMidH;
  uniform vec2 uNear;
  uniform vec2 uMid;
  uniform vec3 uSiteUp;
  uniform vec3 uSiteEast;
  uniform vec3 uSiteNorth;
`

export const simTerrainFunctionsGLSL = /* glsl */ `
  vec4 bsplineW(float v) {
    vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
    vec4 s = n * n * n;
    float x = s.x;
    float y = s.y - 4.0 * s.x;
    float z = s.z - 4.0 * s.y + 6.0 * s.x;
    return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
  }

  float sampleBicubic(sampler2D t, vec2 uv) {
    vec2 size = vec2(textureSize(t, 0));
    vec2 st = uv * size - 0.5;
    vec2 f = fract(st);
    st -= f;
    vec4 xc = bsplineW(f.x);
    vec4 yc = bsplineW(f.y);
    vec4 c = st.xxyy + vec2(-0.5, 1.5).xyxy;
    vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
    vec4 o = (c + vec4(xc.yw, yc.yw) / s) / size.xxyy;
    float s0 = textureLod(t, o.xz, 0.0).r;
    float s1 = textureLod(t, o.yz, 0.0).r;
    float s2 = textureLod(t, o.xw, 0.0).r;
    float s3 = textureLod(t, o.yw, 0.0).r;
    float sx = s.x / (s.x + s.y);
    float sy = s.z / (s.z + s.w);
    return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
  }

  float sampleLevel(sampler2D t, vec2 uv, float lodKm, float texelKm) {
    float m = log2(max(lodKm, 1e-6) / texelKm);
    float v = textureLod(t, uv, max(m, 0.0)).r;
    if (m < -0.4) {
      float cubic = sampleBicubic(t, uv);
      v = m < -1.0 ? cubic : mix(cubic, v, (m + 1.0) / 0.6);
    }
    return v;
  }

  float edgeW(vec2 uv) {
    vec2 e = min(uv, 1.0 - uv);
    return smoothstep(0.0, 0.06, min(e.x, e.y));
  }

  float detailW(float lodKm, float coarserTexel) {
    return 1.0 - smoothstep(0.5 * coarserTexel, coarserTexel, lodKm);
  }

  vec2 latLonOf(vec3 p) {
    return vec2(asin(clamp(p.y, -1.0, 1.0)), atan(p.x, p.z));
  }

  float heightAt(vec3 P, float lodKm) {
    // Fast path inside the polar cap (map views): straight to the stereographic
    // levels, no trig, no global lookup. Same result as the general path
    // wherever the wide level fully covers the point.
    if (P.y < -0.9 && uHasSite < 0.5) {
      vec2 XY = 2.0 * uRadiusKm * vec2(P.x, P.z) / (1.0 - P.y);
      vec2 uvW = XY / (2.0 * uPW.x) + 0.5;
      float wW = edgeW(uvW) * detailW(lodKm, uGlobalTexel);
      if (wW >= 0.999) {
        vec2 uvF = XY / (2.0 * uPF.x) + 0.5;
        float wF = edgeW(uvF) * detailW(lodKm, uPW.y);
        if (wF >= 0.999) return sampleLevel(uPFH, uvF, lodKm, uPF.y);
        float hW = sampleLevel(uPWH, uvW, lodKm, uPW.y);
        return wF > 0.0 ? mix(hW, sampleLevel(uPFH, uvF, lodKm, uPF.y), wF) : hW;
      }
    }
    vec2 ll = latLonOf(P);
    float lat = ll.x;
    float lon = ll.y;
    float h = sampleLevel(uGlobalH, vec2(lon / TAU, 0.5 - lat / PI), lodKm, uGlobalTexel);

    // near-side pyramid (patches centered on 0°N 0°E)
    if (abs(lat) < 0.6 && abs(lon) < 0.6) {
      vec2 uv = vec2((lon - uL2Info.y) / (2.0 * uL2Info.z) + 0.5, (uL2Info.x - lat) / (2.0 * uL2Info.z) + 0.5);
      float w = edgeW(uv) * detailW(lodKm, uGlobalTexel);
      if (w > 0.0) {
        h = mix(h, sampleLevel(uL2H, uv, lodKm, uL2Info.w), w);
        uv = vec2((lon - uL1Info.y) / (2.0 * uL1Info.z) + 0.5, (uL1Info.x - lat) / (2.0 * uL1Info.z) + 0.5);
        w = edgeW(uv) * detailW(lodKm, uL2Info.w);
        if (w > 0.0) {
          h = mix(h, sampleLevel(uL1H, uv, lodKm, uL1Info.w), w);
          uv = vec2((lon - uL0Info.y) / (2.0 * uL0Info.z) + 0.5, (uL0Info.x - lat) / (2.0 * uL0Info.z) + 0.5);
          w = edgeW(uv) * detailW(lodKm, uL1Info.w);
          if (w > 0.0) h = mix(h, sampleLevel(uL0H, uv, lodKm, uL0Info.w), w);
        }
      }
    }

    // south polar pyramid (stereographic)
    if (P.y < -0.85) {
      float d = 1.0 - P.y;
      vec2 XY = 2.0 * uRadiusKm * vec2(P.x, P.z) / d;
      vec2 uv = XY / (2.0 * uPW.x) + 0.5;
      float w = edgeW(uv) * detailW(lodKm, uGlobalTexel);
      if (w > 0.0) {
        h = mix(h, sampleLevel(uPWH, uv, lodKm, uPW.y), w);
        uv = XY / (2.0 * uPF.x) + 0.5;
        w = edgeW(uv) * detailW(lodKm, uPW.y);
        if (w > 0.0) h = mix(h, sampleLevel(uPFH, uv, lodKm, uPF.y), w);
      }
    }

    // site patches (tangent plane at the selected site)
    if (uHasSite > 0.5) {
      float cu = dot(P, uSiteUp);
      if (cu > 0.95) {
        vec2 xy = uRadiusKm * vec2(dot(P, uSiteEast), dot(P, uSiteNorth)) / cu;
        vec2 uv = vec2(xy.x / (2.0 * uMid.x) + 0.5, 0.5 - xy.y / (2.0 * uMid.x));
        float w = edgeW(uv) * detailW(lodKm, 0.4);
        if (w > 0.0) {
          h = mix(h, sampleLevel(uMidH, uv, lodKm, uMid.y), w);
          uv = vec2(xy.x / (2.0 * uNear.x) + 0.5, 0.5 - xy.y / (2.0 * uNear.x));
          w = edgeW(uv) * detailW(lodKm, uMid.y);
          if (w > 0.0) h = mix(h, sampleLevel(uNearH, uv, lodKm, uNear.y), w);
        }
      }
    }
    return h;
  }

  /** Tangent basis without a singularity at the poles. */
  void tangentBasis(vec3 P, out vec3 t1, out vec3 t2) {
    vec3 a = abs(P.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    t1 = normalize(cross(a, P));
    t2 = cross(P, t1);
  }

  /** Surface normal from height finite differences, with vertical exaggeration. */
  vec3 normalAt(vec3 P, float dKm, float scale) {
    vec3 t1, t2;
    tangentBasis(P, t1, t2);
    float e = dKm / uRadiusKm;
    float h1 = heightAt(normalize(P + t1 * e), dKm);
    float h2 = heightAt(normalize(P - t1 * e), dKm);
    float h3 = heightAt(normalize(P + t2 * e), dKm);
    float h4 = heightAt(normalize(P - t2 * e), dKm);
    float k = scale / (2.0 * dKm);
    return normalize(P - (h1 - h2) * k * t1 - (h3 - h4) * k * t2);
  }

  /**
   * Fraction of a disc (Sun: 0.267°, Earth: ~0.95° radius) visible from the
   * point P at height h0 (true, unexaggerated km), marching toward D.
   * Includes lunar curvature; penumbra from the disc's angular size.
   */
  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  float discVisibility(vec3 P, float h0, vec3 D, float discRad, float lodKm, int steps, float jitter) {
    float R = uRadiusKm;
    float sinE = dot(P, D);
    if (sinE < -0.12) return 0.0;
    // start from the data surface (not the mesh), lifted by a footprint-sized bias
    float hData = max(h0, heightAt(P, max(lodKm, 0.003)));
    vec3 O = P * (R + hData + 0.002 + lodKm * 0.35);
    float relief = 11.0;
    float sMax = clamp(R * (-sinE + sqrt(sinE * sinE + 2.0 * relief / R)), 2.0, 700.0);
    // per-pixel jitter turns step banding into fine noise hidden by the penumbra
    float s = max(lodKm * 1.5, 0.03) * (0.65 + 0.7 * jitter);
    float growth = pow(sMax / s, 1.0 / float(steps));
    float vis = 1.0;
    for (int i = 0; i < 96; i++) {
      if (i >= steps) break;
      vec3 X = O + D * s;
      float r = length(X);
      float ht = heightAt(X / r, max(lodKm, s * 0.006));
      vis = min(vis, smoothstep(-discRad, discRad, (r - R - ht) / s));
      if (vis <= 0.002) break;
      s *= growth;
    }
    return vis;
  }
`

const placeholder = (() => {
  const t = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType)
  t.needsUpdate = true
  return t
})()

/** Uniform values for simTerrainUniformsGLSL. Site uniforms are updated by setSiteUniforms. */
export function simTerrainUniforms(assets: SimAssets) {
  const [l0, l1, l2] = assets.moon.patches
  return {
    uRadiusKm: { value: assets.moon.manifest.radiusKm },
    uGlobalH: { value: assets.moon.global.texture },
    uGlobalTexel: { value: assets.moon.global.texelKm },
    uL0H: { value: l0.texture },
    uL1H: { value: l1.texture },
    uL2H: { value: l2.texture },
    uL0Info: { value: l0.info },
    uL1Info: { value: l1.info },
    uL2Info: { value: l2.info },
    uPWH: { value: assets.poleWide.texture },
    uPFH: { value: assets.poleFine.texture },
    uPW: { value: new THREE.Vector2(assets.poleWide.halfExtentKm, assets.poleWide.cellKm) },
    uPF: { value: new THREE.Vector2(assets.poleFine.halfExtentKm, assets.poleFine.cellKm) },
    uHasSite: { value: 0 },
    uNearH: { value: placeholder as THREE.Texture },
    uMidH: { value: placeholder as THREE.Texture },
    uNear: { value: new THREE.Vector2(1, 1) },
    uMid: { value: new THREE.Vector2(1, 1) },
    uSiteUp: { value: new THREE.Vector3(0, 1, 0) },
    uSiteEast: { value: new THREE.Vector3(1, 0, 0) },
    uSiteNorth: { value: new THREE.Vector3(0, 0, 1) },
  }
}

export function setSiteUniforms(
  u: ReturnType<typeof simTerrainUniforms>,
  site: SiteTerrain | null,
  frame: { up: number[]; east: number[]; north: number[] } | null,
) {
  if (!site || !frame) {
    u.uHasSite.value = 0
    return
  }
  u.uHasSite.value = 1
  u.uNearH.value = site.near.texture
  u.uMidH.value = site.mid.texture
  u.uNear.value.set(site.near.halfExtentKm, site.near.cellKm)
  u.uMid.value.set(site.mid.halfExtentKm, site.mid.cellKm)
  u.uSiteUp.value.fromArray(frame.up)
  u.uSiteEast.value.fromArray(frame.east)
  u.uSiteNorth.value.fromArray(frame.north)
}
