import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame } from '../state/frame'

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
  uniform mat3 uToIcrf;
  uniform float uIntensity;
  uniform float uPixelAngle; // radians per screen pixel
  varying vec3 vWorld;
  void main() {
    vec3 dir = normalize(uToIcrf * normalize(vWorld - cameraPosition));
    float ra = atan(dir.y, dir.x);
    float dec = asin(clamp(dir.z, -1.0, 1.0));
    float u1 = fract(ra / TAU);
    float u2 = fract(ra / TAU + 0.5) - 0.5;
    float u = fwidth(u1) <= fwidth(u2) + 1e-7 ? u1 : u2;
    vec2 uv = vec2(u, dec / PI + 0.5);
    vec3 col = texture(uStars, uv).rgb;

    // When zoomed in past the map's resolution, draw each star texel as a
    // crisp point at its true position over a smooth Milky Way glow, instead
    // of letting bilinear filtering blow it up into a fuzzy square.
    vec2 size = vec2(textureSize(uStars, 0));
    float texelAngle = PI / size.y;
    float mag = texelAngle / uPixelAngle;
    if (mag > 1.2) {
      vec2 st = uv * size;
      vec2 center = (floor(st) + 0.5) / size;
      vec3 star = textureLod(uStars, center, 0.0).rgb;
      vec3 glow = textureLod(uStars, uv, 2.5).rgb;
      vec2 d = (st - floor(st) - 0.5) * vec2(texelAngle * 2.0 * cos(dec), texelAngle) / uPixelAngle;
      float point = exp(-dot(d, d) / 1.1);
      vec3 sharp = glow * 0.45 + max(star - glow, 0.0) * point * 1.6;
      col = mix(col, sharp, smoothstep(1.2, 2.5, mag));
    }
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`

/**
 * Star sphere in true orientation for the simulated moment. `localToScene`
 * maps this scene's frame to the Moon frame (identity for map views, the
 * site's ENU basis for the stand view).
 */
export default function SimSky({
  stars,
  radius,
  intensity = 0.5,
  localToScene,
}: {
  stars: THREE.Texture
  radius: number
  intensity?: number
  localToScene?: THREE.Matrix3
}) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uStars: { value: stars },
          uToIcrf: { value: new THREE.Matrix3() },
          uIntensity: { value: intensity },
          uPixelAngle: { value: 0.001 },
        },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [stars, intensity],
  )

  const mesh = useMemo(() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), material)
    m.renderOrder = -10
    m.frustumCulled = false
    return m
  }, [radius, material])

  useFrame(({ camera, size }) => {
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 40
    material.uniforms.uPixelAngle.value = THREE.MathUtils.degToRad(fov) / Math.max(1, size.height)
    const m = material.uniforms.uToIcrf.value as THREE.Matrix3
    m.copy(frame.sceneToIcrf)
    if (localToScene) m.multiply(localToScene)
    // keep the sky centered on the camera so parallax never shows
    mesh.position.copy(camera.position)
  })

  return <primitive object={mesh} />
}
