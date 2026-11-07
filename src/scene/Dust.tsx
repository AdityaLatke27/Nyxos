import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { intro } from '../intro/introState'

const COUNT = 900

const vertexShader = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelScale;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    vec3 p = position;
    // slow electrostatic drift
    p.x += sin(uTime * 0.07 + aSeed * 31.0) * 0.0004;
    p.y += cos(uTime * 0.05 + aSeed * 17.0) * 0.0004;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    float size = clamp(uPixelScale * (0.6 + aSeed) * 0.0016 / dist, 2.5, 26.0);
    gl_PointSize = size;
    // Only motes fairly near the lens read as dust; distant ones would just be
    // pixel noise on the terrain. Bigger (nearer, defocused) motes are dimmer.
    vAlpha = smoothstep(0.003, 0.014, dist) * (1.0 - smoothstep(0.05, 0.14, dist)) * clamp(7.0 / size, 0.12, 1.0);
    vSeed = aSeed;
    gl_Position = projectionMatrix * mv;
  }
`

const fragmentShader = /* glsl */ `
  uniform float uOpacity;
  uniform float uTime;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    float core = exp(-r * r * 22.0);
    float twinkle = 0.65 + 0.35 * sin(uTime * (0.6 + vSeed) + vSeed * 40.0);
    float a = core * vAlpha * uOpacity * twinkle;
    // AdditiveBlending in three is SRC_ALPHA, ONE: carry intensity in alpha.
    gl_FragColor = vec4(vec3(1.0, 0.95, 0.86), a * 0.55);
  }
`

export default function Dust() {
  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3)
    const seeds = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      // log-uniform altitude between ~4 km and ~430 km above Sinus Medii
      const alt = Math.exp(Math.log(0.0025) + Math.random() * (Math.log(0.25) - Math.log(0.0025)))
      // Roughly fill the view at the depths where each mote is visible
      // (motes only render within ~0.14 R of the lens).
      const rad = Math.sqrt(Math.random()) * (0.03 + alt * 0.6)
      const ang = Math.random() * Math.PI * 2
      positions[i * 3] = Math.cos(ang) * rad
      positions[i * 3 + 1] = Math.sin(ang) * rad
      positions[i * 3 + 2] = 1 + alt
      seeds[i] = Math.random()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    const m = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uPixelScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    return { geometry: g, material: m }
  }, [])

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    material.uniforms.uOpacity.value = intro.dust
    material.uniforms.uPixelScale.value = state.size.height * state.viewport.dpr
  })

  return <points geometry={geometry} material={material} frustumCulled={false} />
}
