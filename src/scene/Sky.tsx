import { useMemo } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../astro/ephemeris'

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const fragmentShader = /* glsl */ `
  #define TAU 6.283185307179586
  #define PI 3.141592653589793
  uniform sampler2D uStars;
  uniform mat3 uSceneToIcrf;
  uniform float uIntensity;
  varying vec3 vWorld;

  void main() {
    vec3 dir = normalize(uSceneToIcrf * normalize(vWorld - cameraPosition));
    float ra = atan(dir.y, dir.x);
    float dec = asin(clamp(dir.z, -1.0, 1.0));
    float u1 = fract(ra / TAU);
    float u2 = fract(ra / TAU + 0.5) - 0.5;
    float u = fwidth(u1) <= fwidth(u2) + 1e-7 ? u1 : u2;
    vec3 c = texture(uStars, vec2(u, dec / PI + 0.5)).rgb;
    gl_FragColor = vec4(c * uIntensity, 1.0);
  }
`

export default function Sky({ stars, icrfToScene }: { stars: THREE.Texture; icrfToScene: [Vec3, Vec3, Vec3] }) {
  const material = useMemo(() => {
    const [r0, r1, r2] = icrfToScene
    // scene = M * icrf with M's rows r0..r2, so icrf = Mᵀ * scene.
    const sceneToIcrf = new THREE.Matrix3().set(
      r0[0], r1[0], r2[0],
      r0[1], r1[1], r2[1],
      r0[2], r1[2], r2[2],
    )
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uStars: { value: stars },
        uSceneToIcrf: { value: sceneToIcrf },
        uIntensity: { value: 0.55 },
      },
      side: THREE.BackSide,
      depthWrite: false,
    })
  }, [stars, icrfToScene])

  return (
    <mesh material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[900, 96, 48]} />
    </mesh>
  )
}
