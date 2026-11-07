import * as THREE from 'three'
import type { HeightLevel, MoonAssets } from './loadMoonAssets'
import { terrainFunctionsGLSL, terrainUniformsGLSL } from './terrainGLSL'

/**
 * Ray-marches every texel of every elevation level toward the Sun and stores
 * the visible fraction of the solar disc. Runs once (the Sun is fixed for the
 * chosen date), in horizontal strips spread across frames so a slow GPU never
 * hits a driver timeout.
 */

const bakeVertex = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const bakeFragment = /* glsl */ `
  ${terrainUniformsGLSL}
  ${terrainFunctionsGLSL}
  uniform vec3 uSunDir;
  uniform vec2 uSize;
  uniform vec4 uTarget;      // (latC, lonC, halfExtent, texelKm) — halfExtent = PI means global
  uniform float uIsGlobal;

  const float SUN_ANGULAR_RADIUS = 0.004654;
  const int STEPS = 112;

  void main() {
    vec2 uv = gl_FragCoord.xy / uSize;
    float lat, lon;
    if (uIsGlobal > 0.5) {
      lon = uv.x * TAU;
      lat = (0.5 - uv.y) * PI;
    } else {
      lon = uTarget.y + (uv.x - 0.5) * 2.0 * uTarget.z;
      lat = uTarget.x - (uv.y - 0.5) * 2.0 * uTarget.z;
    }
    float texelKm = uTarget.w;
    vec3 P = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
    vec3 S = uSunDir;
    float R = uRadiusKm;
    float sinE = dot(P, S);

    // Even a 10 km peak cannot see a Sun more than ~6° below the spherical horizon.
    if (sinE < -0.11) { gl_FragColor = vec4(0.0); return; }

    float h0 = heightKm(lat, lon, texelKm) * uHeightScale;
    vec3 O = P * (R + h0);
    float relief = 11.0 * uHeightScale;
    float sMax = R * (-sinE + sqrt(sinE * sinE + 2.0 * relief / R));
    sMax = clamp(sMax, 4.0 * texelKm, 700.0);
    float s = 1.5 * texelKm;
    float growth = pow(sMax / s, 1.0 / float(STEPS));

    float vis = 1.0;
    for (int i = 0; i < STEPS; i++) {
      vec3 X = O + S * s;
      float r = length(X);
      vec2 ll = latLon(X / r);
      float lod = max(texelKm, s * 0.006);
      float ht = heightKm(ll.x, ll.y, lod) * uHeightScale;
      float clearance = (r - R - ht) / s;
      vis = min(vis, smoothstep(-SUN_ANGULAR_RADIUS, SUN_ANGULAR_RADIUS, clearance));
      if (vis <= 0.002) break;
      s *= growth;
    }
    gl_FragColor = vec4(vis, vis, vis, 1.0);
  }
`

export interface VisibilityMaps {
  global: THREE.Texture
  patches: THREE.Texture[]
  dispose: () => void
}

export function terrainUniforms(assets: MoonAssets, heightScale: number) {
  const [l0, l1, l2] = assets.patches
  return {
    uRadiusKm: { value: assets.manifest.radiusKm },
    uHeightScale: { value: heightScale },
    uGlobalInfo: { value: assets.global.info },
    uL0Info: { value: l0.info },
    uL1Info: { value: l1.info },
    uL2Info: { value: l2.info },
    uGlobalH: { value: assets.global.texture },
    uL0H: { value: l0.texture },
    uL1H: { value: l1.texture },
    uL2H: { value: l2.texture },
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

export async function bakeVisibility(
  renderer: THREE.WebGLRenderer,
  assets: MoonAssets,
  sunDir: THREE.Vector3,
  heightScale: number,
  onProgress: (fraction: number) => void,
): Promise<VisibilityMaps> {
  const material = new THREE.ShaderMaterial({
    vertexShader: bakeVertex,
    fragmentShader: bakeFragment,
    uniforms: {
      ...terrainUniforms(assets, heightScale),
      uSunDir: { value: sunDir.clone().normalize() },
      uSize: { value: new THREE.Vector2() },
      uTarget: { value: new THREE.Vector4() },
      uIsGlobal: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(quad)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const jobs: { level: HeightLevel; global: boolean }[] = [
    { level: assets.global, global: true },
    ...assets.patches.map((level) => ({ level, global: false })),
  ]
  const totalTexels = jobs.reduce((a, j) => a + j.level.width * j.level.height, 0)
  let doneTexels = 0

  const targets: THREE.WebGLRenderTarget[] = []
  const prevTarget = renderer.getRenderTarget()
  const prevAutoClear = renderer.autoClear
  renderer.autoClear = false

  for (const { level, global } of jobs) {
    // Mip storage must be declared up front: three allocates immutable
    // texStorage, and regenerates the chain after every render into it.
    const target = new THREE.WebGLRenderTarget(level.width, level.height, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: global ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    })
    target.texture.anisotropy = 4
    material.uniforms.uSize.value.set(level.width, level.height)
    material.uniforms.uTarget.value.copy(level.info)
    material.uniforms.uIsGlobal.value = global ? 1 : 0

    const strip = 128
    for (let y = 0; y < level.height; y += strip) {
      const h = Math.min(strip, level.height - y)
      target.viewport.set(0, 0, level.width, level.height)
      target.scissor.set(0, y, level.width, h)
      target.scissorTest = true
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      renderer.setRenderTarget(prevTarget)
      doneTexels += level.width * h
      onProgress(doneTexels / totalTexels)
      await nextFrame()
    }
    target.scissorTest = false
    targets.push(target)
  }

  renderer.autoClear = prevAutoClear
  material.dispose()
  quad.geometry.dispose()

  return {
    global: targets[0].texture,
    patches: targets.slice(1).map((t) => t.texture),
    dispose: () => targets.forEach((t) => t.dispose()),
  }
}
