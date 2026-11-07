import * as THREE from 'three'
import type { MoonAssets } from './loadMoonAssets'
import type { VisibilityMaps } from './bakeVisibility'
import { terrainUniforms } from './bakeVisibility'
import {
  terrainFunctionsGLSL,
  terrainUniformsGLSL,
  visibilityFunctionsGLSL,
  visibilityUniformsGLSL,
} from './terrainGLSL'

const vertexShader = /* glsl */ `
  ${terrainUniformsGLSL}
  varying vec3 vPos;

  void main() {
    vec3 p = normalize(position);
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lon = atan(p.x, p.z);
    // Limb relief from the global LOLA map (±10 km is ~0.6% of the radius).
    float h = textureLod(uGlobalH, vec2(lon / TAU, 0.5 - lat / PI), 0.0).r;
    vec3 pos = p * (1.0 + h * uHeightScale / uRadiusKm);
    vPos = pos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  ${terrainUniformsGLSL}
  ${visibilityUniformsGLSL}
  ${terrainFunctionsGLSL}
  ${visibilityFunctionsGLSL}

  uniform sampler2D uColor;
  uniform vec3 uSunDir;
  uniform vec3 uEarthDir;
  uniform float uSunIntensity;
  uniform float uEarthshine;
  uniform float uExposure;
  uniform float uAlbedoGain;

  varying vec3 vPos;

  vec3 albedoAt(float lat, float lon) {
    // Tarini's trick: pick the longitude parameterisation without a seam here
    // so mip selection doesn't break along lon = 0 (the near-side center).
    float u1 = fract(lon / TAU);
    float u2 = fract(lon / TAU + 0.5) - 0.5;
    float u = fwidth(u1) <= fwidth(u2) + 1e-7 ? u1 : u2;
    return texture(uColor, vec2(u, lat / PI + 0.5)).rgb;
  }

  void main() {
    vec3 P = normalize(vPos);
    vec2 ll = latLon(P);
    float lat = ll.x;
    float lon = ll.y;

    float footprintKm = max(length(fwidth(vPos)) * uRadiusKm, 0.012);
    vec3 albedo = albedoAt(lat, lon) * uAlbedoGain;

    vec3 N = terrainNormal(P, lat, lon, max(footprintKm, 0.045));
    vec3 V = normalize(cameraPosition - vPos);
    vec3 S = uSunDir;

    float mu0 = max(dot(N, S), 0.0);
    float mu = max(dot(N, V), 0.0);
    float vis = sunVisibility(lat, lon, footprintKm);

    // Lunar-Lambert (McEwen 1991): blend of Lommel-Seeliger and Lambert,
    // weighted by phase angle. This is why the real Moon's disc looks flat.
    float g = degrees(acos(clamp(dot(S, V), -1.0, 1.0)));
    float L = clamp(1.0 - 0.019 * g + 2.42e-4 * g * g - 1.46e-6 * g * g * g, 0.0, 1.0);
    float reflectance = L * 2.0 * mu0 / (mu0 + mu + 1e-4) + (1.0 - L) * mu0;

    vec3 sunlit = albedo * reflectance * vis * uSunIntensity;
    vec3 earthlit = albedo * max(dot(N, uEarthDir), 0.0) * uEarthshine * vec3(0.78, 0.86, 1.0);

    gl_FragColor = vec4((sunlit + earthlit) * uExposure, 1.0);
  }
`

export function createMoonMaterial(
  assets: MoonAssets,
  vis: VisibilityMaps,
  sunDir: THREE.Vector3,
  earthDir: THREE.Vector3,
  earthIlluminated: number,
  heightScale: number,
) {
  const [v0, v1, v2] = vis.patches
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      ...terrainUniforms(assets, heightScale),
      uGlobalV: { value: vis.global },
      uL0V: { value: v0 },
      uL1V: { value: v1 },
      uL2V: { value: v2 },
      uColor: { value: assets.color },
      uSunDir: { value: sunDir.clone().normalize() },
      uEarthDir: { value: earthDir.clone().normalize() },
      uSunIntensity: { value: 3.1 },
      // Real earthshine is ~1e-4 of sunlight; this is exaggerated like a long
      // exposure so the night side reads faintly and the full disc stays legible.
      uEarthshine: { value: 0.32 * earthIlluminated },
      uExposure: { value: 1 },
      uAlbedoGain: { value: 1 },
    },
  })
}
