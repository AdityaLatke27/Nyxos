import * as THREE from 'three'
import type { SimAssets } from '../data/types'
import { simTerrainFunctionsGLSL, simTerrainUniforms, simTerrainUniformsGLSL } from '../terrain/simTerrainGLSL'

export const CAP_HALF_KM = 307.2

const shadingGLSL = /* glsl */ `
  uniform sampler2D uColor;
  uniform vec3 uSunDir;
  uniform vec3 uEarthPos;     // km, moon-centered scene frame
  uniform float uHeightScale;
  uniform float uExposure;
  uniform float uEarthshine;
  uniform float uSunIntensity;
  uniform float uCompress;
  uniform float uFill;
  uniform float uHaze;
  uniform float uTime;

  const float SUN_R = 0.00466;   // 0.267°
  const float EARTH_R = 0.0166;  // ~0.95°

  vec3 albedoAt(vec2 ll) {
    float u1 = fract(ll.y / TAU);
    float u2 = fract(ll.y / TAU + 0.5) - 0.5;
    float u = fwidth(u1) <= fwidth(u2) + 1e-7 ? u1 : u2;
    return texture(uColor, vec2(u, ll.x / PI + 0.5)).rgb;
  }

  // Lunar-Lambert (McEwen 1991)
  float lunarLambert(vec3 N, vec3 S, vec3 V) {
    float mu0 = max(dot(N, S), 0.0);
    float mu = max(dot(N, V), 0.0);
    float g = degrees(acos(clamp(dot(S, V), -1.0, 1.0)));
    float L = clamp(1.0 - 0.019 * g + 2.42e-4 * g * g - 1.46e-6 * g * g * g, 0.0, 1.0);
    return L * 2.0 * mu0 / (mu0 + mu + 1e-4) + (1.0 - L) * mu0;
  }

  // Soft / Balanced: ease bright sun-facing slopes toward the mid-tones (x = 0.2 unchanged)
  float sunTone(float x) { return x * (1.0 + 0.2 * uCompress) / (1.0 + uCompress * x); }
  // artistic fill (Light & shadow: Soft / Balanced): mostly overhead, leaning a
  // little toward the Sun's azimuth, so relief stays readable inside shadows
  vec3 fillLight(vec3 albedo, vec3 N, vec3 up) {
    vec3 t = uSunDir - up * dot(uSunDir, up);
    float tl = length(t);
    vec3 F = normalize(up + (tl > 1e-4 ? t * (0.45 / tl) : vec3(0.0)));
    float k = max(dot(N, F), 0.0);
    return albedo * (k * k) * uFill * uSunIntensity;
  }

  vec3 shade(vec3 albedo, vec3 N, vec3 V, float vis, vec3 P, float h0) {
    vec3 E = normalize(uEarthPos - P * (uRadiusKm + h0));
    vec3 sun = albedo * sunTone(lunarLambert(N, uSunDir, V) * vis) * uSunIntensity;
    vec3 earth = albedo * max(dot(N, E), 0.0) * uEarthshine * vec3(0.75, 0.85, 1.0);
    return sun + earth + fillLight(albedo, N, P);
  }

  // Artistic exospheric haze: pools in low ground, lit where the sun reaches,
  // glows when looking toward the sun. Off when uHaze = 0.
  vec3 applyHaze(vec3 col, vec3 P, float h0, float vis, vec3 V, float distKm) {
    // only near the surface: from orbit the Moon must look airless
    float camAlt = (length(cameraPosition) - 1.0) * uRadiusKm;
    float near = 1.0 - smoothstep(350.0, 1400.0, camAlt);
    if (uHaze * near <= 0.0) return col;
    distKm = min(distKm, 600.0);
    float smoothH = heightAt(P, 9.0);
    float pool = clamp((smoothH - h0) / 1.6, 0.0, 1.0);
    float aerial = 1.0 - exp(-distKm / 900.0);
    float forward = pow(max(dot(-V, uSunDir), 0.0), 6.0);
    float sunUp = smoothstep(-0.03, 0.02, dot(P, uSunDir));
    vec3 litHaze = vec3(1.0, 0.92, 0.8) * (0.04 + 0.3 * forward) * sunUp;
    vec3 shadowHaze = vec3(0.006, 0.008, 0.012) + vec3(0.11, 0.115, 0.125) * uFill;
    // haze over sunlit ground is lit; haze pooled in shadow stays dark,
    // so shadowed crater floors read as volumes rather than flat black
    vec3 haze = mix(shadowHaze, litHaze, vis);
    float amount = clamp(pool * 0.32 + aerial * 0.18, 0.0, 0.45) * uHaze * near;
    return mix(col, haze * uSunIntensity * 0.5, amount);
  }
`

// Where the globe meets the polar cap both meshes converge on the same smooth
// height (polar data at a 12 km LOD), so their geometry joins without a step.
// Shading is unaffected: both fragment shaders use full-resolution normals.
const SEAM_GLSL = /* glsl */ `
  const float SEAM_LOD = 12.0;
  const float SEAM_BAND = 36.0;
  float capEdgeDist(vec3 P) {
    vec2 XY = 2.0 * uRadiusKm * P.xz / (1.0 - P.y);
    return uCapHalf - max(abs(XY.x), abs(XY.y));
  }
`

const globeVertex = /* glsl */ `
  ${simTerrainUniformsGLSL}
  ${simTerrainFunctionsGLSL}
  uniform float uHeightScale;
  uniform float uCapHalf;
  varying vec3 vPos;
  ${SEAM_GLSL}
  void main() {
    vec3 p = normalize(position);
    vec2 ll = vec2(asin(clamp(p.y, -1.0, 1.0)), atan(p.x, p.z));
    float h = textureLod(uGlobalH, vec2(ll.y / TAU, 0.5 - ll.x / PI), 0.0).r;
    if (p.y < -0.9) h = mix(heightAt(p, SEAM_LOD), h, smoothstep(0.0, SEAM_BAND, -capEdgeDist(p)));
    vPos = p * (1.0 + h * uHeightScale / uRadiusKm);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vPos, 1.0);
  }
`

const globeFragment = /* glsl */ `
  ${simTerrainUniformsGLSL}
  ${simTerrainFunctionsGLSL}
  ${shadingGLSL}
  uniform float uCapHalf;
  varying vec3 vPos;

  void main() {
    float fp = max(length(fwidth(vPos)) * uRadiusKm, 0.03);
    vec3 P = normalize(vPos);
    vec2 ll = latLonOf(P);
    vec3 albedo = albedoAt(ll);
    if (P.y < -0.85) {
      vec2 XY = 2.0 * uRadiusKm * P.xz / (1.0 - P.y);
      if (max(abs(XY.x), abs(XY.y)) < uCapHalf - 6.0) discard;
    }
    vec3 V = normalize(cameraPosition - vPos);
    vec3 N = normalAt(P, max(fp, 0.06), uHeightScale);
    float h0 = heightAt(P, fp);
    float vis = discVisibility(P, h0, uSunDir, SUN_R, fp, 32, ign(gl_FragCoord.xy));
    vec3 col = shade(albedo, N, V, vis, P, h0);
    col = applyHaze(col, P, h0, vis, V, length(cameraPosition - vPos) * uRadiusKm);
    gl_FragColor = vec4(col * uExposure, 1.0);
  }
`

const capVertex = /* glsl */ `
  ${simTerrainUniformsGLSL}
  ${simTerrainFunctionsGLSL}
  uniform float uHeightScale;
  uniform float uCapHalf;
  varying vec3 vPos;
  varying vec2 vXY;
  ${SEAM_GLSL}
  void main() {
    vec2 XY = position.xy;
    float rho = length(XY);
    float lat = 2.0 * atan(rho / (2.0 * uRadiusKm)) - PI * 0.5;
    float lon = atan(XY.x, XY.y);
    vec3 P = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
    float edge = uCapHalf - max(abs(XY.x), abs(XY.y));
    float h = edge < SEAM_BAND ? mix(heightAt(P, SEAM_LOD), heightAt(P, 0.6), smoothstep(6.0, SEAM_BAND, edge)) : heightAt(P, 0.6);
    vPos = P * (1.0 + h * uHeightScale / uRadiusKm);
    vXY = XY;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vPos, 1.0);
  }
`

const capFragment = /* glsl */ `
  ${simTerrainUniformsGLSL}
  ${simTerrainFunctionsGLSL}
  ${shadingGLSL}
  uniform int uLayer;
  uniform sampler2D uHeat;
  uniform float uHeatReady;
  uniform sampler2D uLro;
  uniform float uLroHalf;
  uniform float uCapHalf;
  varying vec3 vPos;
  varying vec2 vXY;

  vec3 heatColor(float t) {
    // dark violet -> purple -> orange -> pale yellow
    vec3 c0 = vec3(0.06, 0.03, 0.14);
    vec3 c1 = vec3(0.34, 0.12, 0.52);
    vec3 c2 = vec3(0.94, 0.48, 0.13);
    vec3 c3 = vec3(1.0, 0.95, 0.72);
    if (t < 0.33) return mix(c0, c1, t / 0.33);
    if (t < 0.7) return mix(c1, c2, (t - 0.33) / 0.37);
    return mix(c2, c3, (t - 0.7) / 0.3);
  }

  void main() {
    float fp = max(length(fwidth(vPos)) * uRadiusKm, 0.02);
    vec3 P = normalize(vPos);
    vec2 ll = latLonOf(P);
    vec3 albedo = albedoAt(ll);
    vec3 V = normalize(cameraPosition - vPos);
    float h0 = heightAt(P, fp);
    vec3 N = normalAt(P, max(fp, 0.05), uHeightScale);
    float sunVis = discVisibility(P, h0, uSunDir, SUN_R, fp, 44, ign(gl_FragCoord.xy));
    vec3 lit = shade(albedo, N, V, sunVis, P, h0);
    vec3 col = lit;

    if (uLayer == 1 || uLayer == 2) {
      vec3 E = normalize(uEarthPos - P * (uRadiusKm + h0));
      float ev = discVisibility(P, h0, E, EARTH_R, fp, 44, ign(gl_FragCoord.xy + 17.0));
      vec3 relief = albedo * (0.06 + 0.5 * max(dot(N, normalize(P + vec3(0.25, 0.0, 0.25))), 0.0));
      if (uLayer == 1) {
        col = lit * 0.7 + relief * 0.1;
        col = mix(col, vec3(0.15, 0.55, 1.0) * 0.55, ev * 0.62);
      } else {
        col = lit * 0.8 + relief * 0.06;
        col = mix(col, vec3(0.2, 0.95, 0.45) * 0.65, sunVis * ev * 0.75);
      }
    } else if (uLayer == 3) {
      vec2 uv = vXY / (2.0 * uCapHalf) + 0.5;
      float f = texture(uHeat, uv).r;
      float hill = 0.55 + 0.45 * max(dot(N, normalize(P + vec3(0.3, 0.0, 0.3))), 0.0);
      col = uHeatReady > 0.5 ? heatColor(f) * hill * 0.55 : lit;
    } else if (uLayer == 4) {
      vec2 uv = vXY / (2.0 * uLroHalf) + 0.5;
      float edge = uLroHalf - max(abs(vXY.x), abs(vXY.y));
      float inside = smoothstep(0.0, 14.0, edge);
      float g = texture(uLro, uv).r;
      col = mix(lit, vec3(g) * 0.42, inside);
    }

    if (uLayer != 3 && uLayer != 4) {
      col = applyHaze(col, P, h0, sunVis, V, length(cameraPosition - vPos) * uRadiusKm);
    }
    gl_FragColor = vec4(col * uExposure, 1.0);
  }
`

export function createMapMaterials(assets: SimAssets, heat: THREE.Texture) {
  const shared = {
    ...simTerrainUniforms(assets),
    uColor: { value: assets.moon.color },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uEarthPos: { value: new THREE.Vector3(0, 0, 384400) },
    uHeightScale: { value: 4 },
    uExposure: { value: 1 },
    uEarthshine: { value: 0.01 },
    uSunIntensity: { value: 3.1 },
    uCompress: { value: 0 },
    uFill: { value: 0 },
    uHaze: { value: 1 },
    uTime: { value: 0 },
    uCapHalf: { value: CAP_HALF_KM },
  }
  const globe = new THREE.ShaderMaterial({
    vertexShader: globeVertex,
    fragmentShader: globeFragment,
    uniforms: shared,
  })
  const cap = new THREE.ShaderMaterial({
    vertexShader: capVertex,
    fragmentShader: capFragment,
    uniforms: {
      ...shared,
      uLayer: { value: 0 },
      uHeat: { value: heat },
      uHeatReady: { value: 0 },
      uLro: { value: assets.lroPole },
      uLroHalf: { value: assets.manifest.lroPole.halfExtentKm },
    },
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  return { globe, cap, shared }
}

/** Grid mesh in south-polar stereographic km; the vertex shader wraps it onto the Moon. */
export function createCapGeometry(segments: number) {
  const g = new THREE.PlaneGeometry(2 * CAP_HALF_KM, 2 * CAP_HALF_KM, segments, segments)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -1, 0), 0.3)
  return g
}
