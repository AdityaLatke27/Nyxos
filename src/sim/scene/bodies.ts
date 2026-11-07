import * as THREE from 'three'
import type { SimAssets } from '../data/types'

/** Greenwich mean sidereal time, radians. */
export function gmst(ms: number) {
  const d = ms / 86400000 + 2440587.5 - 2451545.0
  const deg = 280.46061837 + 360.98564736629 * d
  return (((deg % 360) + 360) % 360) * (Math.PI / 180)
}

/** Earth's body axes (x: Greenwich, z: north) expressed in the scene frame. */
export function earthAxes(ms: number, icrfToScene: THREE.Matrix3) {
  const g = gmst(ms)
  const x = new THREE.Vector3(Math.cos(g), Math.sin(g), 0).applyMatrix3(icrfToScene)
  const z = new THREE.Vector3(0, 0, 1).applyMatrix3(icrfToScene)
  const y = new THREE.Vector3().crossVectors(z, x)
  return { x, y, z }
}

const earthVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vWorld;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const earthFragment = /* glsl */ `
  #define PI 3.141592653589793
  uniform sampler2D uDay;
  uniform sampler2D uClouds;
  uniform sampler2D uNight;
  uniform vec3 uSunDir;
  uniform vec3 uAxisX;
  uniform vec3 uAxisY;
  uniform vec3 uAxisZ;
  uniform float uIntensity;
  varying vec3 vN;
  varying vec3 vWorld;

  void main() {
    vec3 n = normalize(vN);
    vec3 e = vec3(dot(n, uAxisX), dot(n, uAxisY), dot(n, uAxisZ));
    vec2 uv = vec2(atan(e.y, e.x) / (2.0 * PI) + 0.5, asin(clamp(e.z, -1.0, 1.0)) / PI + 0.5);
    vec3 day = texture(uDay, uv).rgb;
    float cloud = texture(uClouds, uv).r;
    vec3 night = texture(uNight, uv).rgb;
    float mu = dot(n, uSunDir);
    float lit = smoothstep(-0.08, 0.12, mu);
    vec3 surface = mix(day, vec3(1.0), cloud * 0.85);
    vec3 V = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    vec3 col = surface * max(mu, 0.0) * 1.15 * lit + night * (1.0 - lit) * (1.0 - cloud) * 0.6;
    col += vec3(0.3, 0.55, 1.0) * rim * smoothstep(-0.2, 0.4, mu) * 0.9;
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`

export function createEarthMaterial(assets: SimAssets) {
  return new THREE.ShaderMaterial({
    vertexShader: earthVertex,
    fragmentShader: earthFragment,
    uniforms: {
      uDay: { value: assets.earthDay },
      uClouds: { value: assets.earthClouds },
      uNight: { value: assets.earthNight },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uAxisX: { value: new THREE.Vector3(1, 0, 0) },
      uAxisY: { value: new THREE.Vector3(0, 1, 0) },
      uAxisZ: { value: new THREE.Vector3(0, 0, 1) },
      uIntensity: { value: 1.6 },
    },
  })
}

const sunFragment = /* glsl */ `
  uniform float uIntensity;
  uniform float uGlow; // 1 = naked-eye glare, 0 = filtered telescope view
  varying vec2 vUv;
  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    // r = 1 at the sprite edge; the photosphere occupies r < 0.16
    float disc = 0.16;
    float x = r / disc;
    // Eddington limb darkening, u = 0.6
    float limb = x < 1.0 ? (0.4 + 0.6 * sqrt(1.0 - x * x)) : 0.0;
    float core = smoothstep(1.02, 0.98, x) * limb * mix(0.7, 26.0, uGlow * uGlow);
    float glow = (exp(-r * 9.0) * 1.6 + exp(-r * 3.0) * 0.18) * uGlow;
    float a = core + glow;
    gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * a * uIntensity, 1.0);
  }
`

const spriteVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Sun billboard; the photosphere is 16% of the quad so the glow has room. */
export function createSunMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: spriteVertex,
    fragmentShader: sunFragment,
    uniforms: { uIntensity: { value: 1 }, uGlow: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

/** Quad size so the photosphere (16% of the quad) subtends the Sun's true 0.533°. */
export function sunQuadSize(distance: number) {
  return (2 * distance * Math.tan((0.2666 * Math.PI) / 180)) / 0.16
}
