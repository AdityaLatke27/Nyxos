import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { SimAssets } from '../data/types'
import { simTerrainFunctionsGLSL, simTerrainUniforms, simTerrainUniformsGLSL } from '../terrain/simTerrainGLSL'

/**
 * First-person terrain around a site. Local frame (km): x = east, y = up,
 * z = south; origin at the ground under the observer. The mesh is a polar
 * grid (arc distance, azimuth); the vertex shader wraps it onto the curved,
 * displaced Moon using numerically stable small-angle forms.
 */

const noiseGLSL = /* glsl */ `
  vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash22(i).x, b = hash22(i + vec2(1, 0)).x, c = hash22(i + vec2(0, 1)).x, d = hash22(i + vec2(1, 1)).x;
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
  // small craters on a jittered grid (height in metres). Sizes follow a steep
  // size-frequency law and each crater has its own state of degradation, from
  // fresh deep bowls with sharp rims to shallow, softened pits.
  float craterField(vec2 p, float cell, float density) {
    vec2 c = floor(p / cell);
    float h = 0.0;
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 id = c + vec2(float(i), float(j));
        vec2 r = hash22(id);
        if (r.y > density) continue;
        vec2 r2 = hash22(id + 17.31);
        vec2 center = (id + 0.2 + 0.6 * r2) * cell;
        float rad = cell * (0.07 + 0.38 * r.x * r.x);
        float d = length(p - center) / rad;
        if (d > 2.2) continue;
        float fresh = fract(r2.x * 7.13 + r2.y * 3.7);
        float depth = mix(0.07, 0.2, fresh);
        float bowl = d < 1.0 ? -(1.0 - pow(d, mix(1.6, 2.4, fresh))) * depth : 0.0;
        float rim = exp(-pow((d - 1.0) * mix(1.8, 3.6, fresh), 2.0)) * mix(0.015, 0.07, fresh);
        h += (bowl + rim) * rad;
      }
    return h;
  }
  // ring spacing of the stand mesh (matches GROWTH in StandScene): vertex step = d * RING_STEP
  const float RING_STEP = 0.035;
  float meshLod(float dKm) { return max(dKm * 1000.0 * RING_STEP, 0.02); }

  // regolith micro-relief in metres at local position p (metres); each octave
  // is rotated and offset so the grids never line up, and fades out once it is
  // finer than lod (metres: vertex spacing for geometry, pixel size for normals)
  float microHeight(vec2 p, float lod) {
    float h = 0.0;
    float w;
    w = 1.0 - smoothstep(20.0, 60.0, lod);
    if (w > 0.0) h += craterField(rot2(2.79) * p - 91.0, 140.0, 0.4) * 0.6 * w;
    w = 1.0 - smoothstep(5.0, 14.0, lod);
    if (w > 0.0) h += craterField(rot2(1.87) * p + 37.0, 31.0, 0.45) * 0.8 * w;
    w = 1.0 - smoothstep(1.5, 4.0, lod);
    if (w > 0.0) h += craterField(rot2(0.61) * p + 13.0, 9.0, 0.5) * w;
    h += (vnoise(p * 0.21) - 0.5) * 0.35 * (1.0 - smoothstep(1.5, 3.0, lod));
    h += (vnoise(rot2(0.9) * p * 0.9) - 0.5) * 0.08 * (1.0 - smoothstep(0.3, 0.7, lod));
    h += (vnoise(p * 3.7) - 0.5) * 0.025 * (1.0 - smoothstep(0.08, 0.18, lod));
    return h;
  }

  // ---- boulders, shared by the ground (for their shadows) and the rock mesh.
  // Two populations on grids in local metres: small rocks near the observer and
  // rarer large boulders further out. Each rock sits fully inside its cell, so a
  // ray only meets rocks in the cells it passes through.
  const float ROCK_C0 = 2.5;
  const float ROCK_RANGE0 = 90.0;
  const float ROCK_C1 = 14.0;
  const float ROCK_RANGE1 = 400.0;

  // radius in metres (0 = no rock); centre (local metres), shape (x, y, z scale), seed
  float rockIn(vec2 cell, float layer, out vec2 center, out vec3 shape, out float seed) {
    float C = layer < 0.5 ? ROCK_C0 : ROCK_C1;
    vec2 a = hash22(cell + layer * 913.7);
    vec2 b = hash22(cell * 1.37 + 41.3 + layer * 37.1);
    vec2 e = hash22(cell * 0.73 - 7.9 + layer * 5.3);
    center = vec2(0.0);
    shape = vec3(1.0);
    seed = b.y;
    // boulders cluster (ejecta of buried craters)
    float density = (layer < 0.5 ? 0.24 : 0.1) * (0.25 + 1.5 * vnoise((cell * C + 500.0 * layer) / 70.0));
    if (a.x > density) return 0.0;
    // cumulative size-frequency N(>r) ~ r^-2.5
    float rmin = layer < 0.5 ? 0.07 : 0.45;
    float rad = min(rmin * pow(max(a.y, 1e-3), -0.4), C * (layer < 0.5 ? 0.4 : 0.18));
    shape = vec3(0.8 + 0.4 * e.x, 0.45 + 0.35 * e.y, 0.8 + 0.4 * fract(e.x * 9.7 + e.y * 3.1));
    float m = rad * 1.25;
    center = cell * C + mix(vec2(m), vec2(C - m), b);
    float dist = length(center);
    if (dist > (layer < 0.5 ? ROCK_RANGE0 : ROCK_RANGE1) || dist < 2.0 + rad) return 0.0;
    return rad;
  }

  // sunlight left after rocks of one layer along the sun ray (soft-edged by the
  // Sun's 0.53 deg disc). p: fragment (local m); hd: unit horizontal sun direction;
  // tanE: sun elevation slope; grad: large-scale ground slope (m/m); zp: micro height at p
  float rockShadowLayer(vec2 p, vec2 hd, float tanE, vec2 grad, float zp, float layer, float maxLen) {
    float C = layer < 0.5 ? ROCK_C0 : ROCK_C1;
    vec2 cell = floor(p / C);
    vec2 stp = vec2(hd.x >= 0.0 ? 1.0 : -1.0, hd.y >= 0.0 ? 1.0 : -1.0);
    vec2 ad = max(abs(hd), vec2(1e-5));
    vec2 tDelta = C / ad;
    vec2 tMax = (stp * ((cell + max(stp, 0.0)) * C - p)) / ad;
    float t = 0.0;
    float lit = 1.0;
    for (int i = 0; i < 28; i++) {
      if (t > maxLen || lit < 0.01) break;
      vec2 c;
      vec3 sh;
      float sd;
      float r = rockIn(cell, layer, c, sh, sd);
      if (r > 0.0) {
        float rh = r * 0.5 * (sh.x + sh.z);
        float rv = r * sh.y;
        float k = rh / rv;
        float zc = dot(grad, c - p) + microHeight(c, meshLod(length(c) * 0.001)) - zp + 0.35 * rv;
        vec3 D = normalize(vec3(hd, tanE * k));
        vec3 S = vec3(c - p, zc * k);
        float ts = dot(S, D);
        if (ts > 0.0) {
          float w = ts * 0.0047 + 0.02 * rh;
          lit *= smoothstep(rh - w, rh + w, length(S - D * ts));
        }
      }
      if (tMax.x < tMax.y) {
        t = tMax.x;
        tMax.x += tDelta.x;
        cell.x += stp.x;
      } else {
        t = tMax.y;
        tMax.y += tDelta.y;
        cell.y += stp.y;
      }
    }
    return lit;
  }
`

const vertex = /* glsl */ `
  ${simTerrainUniformsGLSL}
  ${simTerrainFunctionsGLSL}
  ${noiseGLSL}
  uniform float uSiteH;   // km, ground height at the observer
  uniform float uGrowth;  // ring spacing ratio (lod hint)
  attribute vec2 polar;   // (arc distance km, azimuth rad clockwise from north)
  varying vec3 vP;
  varying vec3 vLocal;
  varying float vH;
  varying float vDist;
  varying vec2 vLp;

  void main() {
    float d = polar.x;
    float th = polar.y;
    float a = d / uRadiusKm;
    vec3 tdir = cos(th) * uSiteNorth + sin(th) * uSiteEast;
    vec3 P = normalize(cos(a) * uSiteUp + sin(a) * tdir);
    float lod = max(d * (uGrowth - 1.0), 0.0004);
    float h = heightAt(P, lod);
    // procedural regolith below the data resolution, fading out by ~3 km
    float near = 1.0 - smoothstep(0.4, 3.0, d);
    vec2 lp = vec2(d * sin(th), d * cos(th)) * 1000.0;
    vLp = lp;
    if (near > 0.0) h += microHeight(lp, meshLod(d)) * 0.001 * near;
    float s = sin(a * 0.5);
    float vert = -(uRadiusKm + h) * 2.0 * s * s + (h - uSiteH);
    float horiz = (uRadiusKm + h) * sin(a);
    vLocal = vec3(horiz * sin(th), vert, -horiz * cos(th));
    vP = P;
    vH = h;
    vDist = d;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vLocal, 1.0);
  }
`

const fragment = /* glsl */ `
  ${simTerrainUniformsGLSL}
  ${simTerrainFunctionsGLSL}
  ${noiseGLSL}
  uniform sampler2D uColor;
  uniform vec3 uSunDir;     // moon frame
  uniform vec3 uEarthPos;   // km, moon frame
  uniform float uSiteH;
  uniform float uExposure;
  uniform float uSunIntensity;
  uniform float uCompress;
  uniform float uFill;
  uniform float uEarthshine;
  uniform float uHaze;
  uniform float uRockShadows;
  uniform vec3 uEye;        // local camera position
  varying vec3 vP;
  varying vec3 vLocal;
  varying float vH;
  varying float vDist;
  varying vec2 vLp;

  const float SUN_R = 0.00466;

  vec3 toMoon(vec3 l) { return l.x * uSiteEast + l.y * uSiteUp - l.z * uSiteNorth; }
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

  float lunarLambert(vec3 N, vec3 S, vec3 V) {
    float mu0 = max(dot(N, S), 0.0);
    float mu = max(dot(N, V), 0.0);
    float g = degrees(acos(clamp(dot(S, V), -1.0, 1.0)));
    float L = clamp(1.0 - 0.019 * g + 2.42e-4 * g * g - 1.46e-6 * g * g * g, 0.0, 1.0);
    return L * 2.0 * mu0 / (mu0 + mu + 1e-4) + (1.0 - L) * mu0;
  }

  void main() {
    vec3 P = normalize(vP);
    float fp = max(length(fwidth(vLocal)), 0.00015);
    vec3 V = normalize(toMoon(uEye - vLocal));
    float dist = length(uEye - vLocal);

    // large-scale normal from the data, fine normal from the regolith field
    vec3 N = normalAt(P, max(fp * 1.5, 0.004), 1.0);
    vec3 Nd = N;
    float near = 1.0 - smoothstep(0.4, 3.0, vDist);
    vec2 lp = vLp;
    float detailFade = near * (1.0 - smoothstep(0.05, 0.6, fp * 1000.0 / 4.0));
    if (detailFade > 0.0) {
      float e = max(fp * 1000.0, 0.03);
      float hx = microHeight(lp + vec2(e, 0.0), e) - microHeight(lp - vec2(e, 0.0), e);
      float hy = microHeight(lp + vec2(0.0, e), e) - microHeight(lp - vec2(0.0, e), e);
      vec3 east = uSiteEast;
      vec3 north = uSiteNorth;
      N = normalize(N - (hx / (2.0 * e)) * east * detailFade - (hy / (2.0 * e)) * north * detailFade);
    }

    vec2 ll = latLonOf(P);
    float u1 = fract(ll.y / TAU);
    float u2 = fract(ll.y / TAU + 0.5) - 0.5;
    float u = fwidth(u1) <= fwidth(u2) + 1e-7 ? u1 : u2;
    vec3 albedo = texture(uColor, vec2(u, ll.x / PI + 0.5)).rgb;
    float speck = mix(1.0, 0.82 + 0.36 * vnoise(lp * 1.7) * vnoise(lp * 0.31 + 7.0), near);
    albedo *= speck;

    float vis = discVisibility(P, vH, uSunDir, SUN_R, max(fp, 0.003), 56, ign(gl_FragCoord.xy));

    // shadows of the boulders (the rock mesh itself is drawn separately)
    vec3 sL = vec3(dot(uSunDir, uSiteEast), dot(uSunDir, uSiteNorth), dot(uSunDir, uSiteUp));
    if (uRockShadows > 0.5 && vis > 0.002 && vDist < 0.6 && sL.z > -0.006) {
      float hl = length(sL.xy);
      vec2 hd = sL.xy / max(hl, 1e-6);
      float tanE = max(sL.z / max(hl, 1e-6), 0.0015);
      vec2 grad = -vec2(dot(Nd, uSiteEast), dot(Nd, uSiteNorth)) / max(dot(Nd, uSiteUp), 0.2);
      float rise = max(tanE - dot(grad, hd), 0.01);
      float zp = microHeight(lp, meshLod(vDist)) * near;
      vis *= rockShadowLayer(lp, hd, tanE, grad, zp, 0.0, min(60.0, 1.2 / rise));
      vis *= rockShadowLayer(lp, hd, tanE, grad, zp, 1.0, min(300.0, 2.9 / rise));
    }
    vec3 E = normalize(uEarthPos - P * (uRadiusKm + vH));
    vec3 col = albedo * sunTone(lunarLambert(N, uSunDir, V) * vis) * uSunIntensity;
    col += albedo * max(dot(N, E), 0.0) * uEarthshine * vec3(0.75, 0.85, 1.0);
    col += fillLight(albedo, N, P);

    // artistic exospheric haze: sunlit haze glows toward the Sun, shadowed haze stays dark
    if (uHaze > 0.0) {
      float amount = (1.0 - exp(-dist / 160.0)) * 0.55 * uHaze;
      float sunUp = smoothstep(-0.02, 0.03, dot(uSiteUp, uSunDir));
      float forward = pow(max(dot(-V, uSunDir), 0.0), 8.0);
      vec3 lit = vec3(1.0, 0.9, 0.78) * (0.04 + 0.6 * forward) * sunUp;
      vec3 haze = mix(vec3(0.012, 0.016, 0.024) + vec3(0.11, 0.115, 0.125) * uFill, lit, mix(0.25, 1.0, vis));
      col = mix(col, haze * uSunIntensity * 0.35, amount);
    }
    gl_FragColor = vec4(col * uExposure, 1.0);
  }
`

export function createStandMaterial(assets: SimAssets) {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      ...simTerrainUniforms(assets),
      uColor: { value: assets.moon.color },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uEarthPos: { value: new THREE.Vector3(0, 0, 384400) },
      uSiteH: { value: 0 },
      uGrowth: { value: 1.035 },
      uExposure: { value: 0.85 },
      uSunIntensity: { value: 3.1 },
      uCompress: { value: 0 },
      uFill: { value: 0 },
      uEarthshine: { value: 0.02 },
      uHaze: { value: 1 },
      uRockShadows: { value: 1 },
      uEye: { value: new THREE.Vector3(0, 0.0017, 0) },
    },
  })
}

const rockVertex = /* glsl */ `
  ${simTerrainUniformsGLSL}
  ${simTerrainFunctionsGLSL}
  ${noiseGLSL}
  uniform float uSiteH;
  attribute vec3 aCell;   // grid cell (x, y) and population (0 small, 1 large)
  varying vec3 vP;
  varying float vH;
  varying vec3 vLocal;
  varying vec3 vShape;
  varying float vSeed;

  void main() {
    vec2 c;
    vec3 shape;
    float seed;
    float r = rockIn(aCell.xy, aCell.z, c, shape, seed);
    if (r <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume
      return;
    }
    // ground under the rock's centre, exactly as the terrain mesh places it
    float d = length(c) * 0.001;
    float th = atan(c.x, c.y);
    float a = d / uRadiusKm;
    vec3 tdir = cos(th) * uSiteNorth + sin(th) * uSiteEast;
    vec3 P = normalize(cos(a) * uSiteUp + sin(a) * tdir);
    float h = heightAt(P, max(d * RING_STEP, 0.0004)) + microHeight(c, meshLod(d)) * 0.001;
    float s = sin(a * 0.5);
    vec3 base = vec3((uRadiusKm + h) * sin(a) * sin(th), -(uRadiusKm + h) * 2.0 * s * s + (h - uSiteH), -(uRadiusKm + h) * sin(a) * cos(th));

    // lumpy, partly buried ellipsoid, turned to a random heading
    vec3 q = position;
    float lump = 1.0 + 0.3 * (vnoise(q.xy * 1.6 + seed * 53.0) - 0.5) + 0.3 * (vnoise(q.yz * 1.9 + seed * 31.0) - 0.5)
      + 0.14 * (vnoise(q.zx * 4.3 + seed * 17.0) - 0.5);
    q *= lump * shape;
    float yaw = seed * 6.2832;
    q.xz = mat2(cos(yaw), sin(yaw), -sin(yaw), cos(yaw)) * q.xz;
    q.y += 0.35 * shape.y;
    vec3 local = base + q * r * 0.001;

    vP = P;
    vH = h;
    vLocal = local;
    vShape = position * 3.0 + seed * 11.0;
    vSeed = seed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
  }
`

const rockFragment = /* glsl */ `
  ${simTerrainUniformsGLSL}
  ${simTerrainFunctionsGLSL}
  ${noiseGLSL}
  uniform sampler2D uColor;
  uniform vec3 uSunDir;
  uniform vec3 uEarthPos;
  uniform float uExposure;
  uniform float uSunIntensity;
  uniform float uCompress;
  uniform float uFill;
  uniform float uEarthshine;
  uniform vec3 uEye;
  varying vec3 vP;
  varying float vH;
  varying vec3 vLocal;
  varying vec3 vShape;
  varying float vSeed;

  const float SUN_R = 0.00466;

  vec3 toMoon(vec3 l) { return l.x * uSiteEast + l.y * uSiteUp - l.z * uSiteNorth; }

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

  void main() {
    // faceted normal from screen derivatives reads as chipped rock
    vec3 nl = normalize(cross(dFdx(vLocal), dFdy(vLocal)));
    if (dot(nl, uEye - vLocal) < 0.0) nl = -nl;
    vec3 N = normalize(toMoon(nl));
    vec3 P = normalize(vP);
    vec2 ll = latLonOf(P);
    vec3 albedo = texture(uColor, vec2(fract(ll.y / TAU), ll.x / PI + 0.5)).rgb;
    // fresh rock is brighter than the mature regolith around it
    albedo *= (1.15 + 0.4 * vSeed) * (0.8 + 0.4 * vnoise(vShape.xy * 2.3) * vnoise(vShape.yz * 0.9 + 3.0));
    float vis = discVisibility(P, vH, uSunDir, SUN_R, 0.003, 40, ign(gl_FragCoord.xy));
    float mu0 = max(dot(N, uSunDir), 0.0);
    vec3 E = normalize(uEarthPos - P * (uRadiusKm + vH));
    vec3 col = albedo * sunTone(mu0 * 1.1 * vis) * uSunIntensity;
    col += albedo * max(dot(N, E), 0.0) * uEarthshine * vec3(0.75, 0.85, 1.0);
    col += fillLight(albedo, N, P);
    gl_FragColor = vec4(col * uExposure, 1.0);
  }
`

/** Boulders; shares the ground material's uniforms so site and Sun updates apply to both. */
export function createRockMaterial(ground: THREE.ShaderMaterial) {
  return new THREE.ShaderMaterial({
    vertexShader: rockVertex,
    fragmentShader: rockFragment,
    uniforms: { ...ground.uniforms },
  })
}

/** One instance per rock-grid cell around the observer; empty cells are culled in the shader. */
export function createRockGeometry() {
  const ico = new THREE.IcosahedronGeometry(1, 2)
  ico.deleteAttribute('normal')
  ico.deleteAttribute('uv')
  const base = mergeVertices(ico)
  ico.dispose()
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  g.setAttribute('position', base.getAttribute('position'))
  const cells: number[] = []
  for (const [C, range, layer] of [
    [2.5, 90, 0],
    [14, 400, 1],
  ]) {
    const n = Math.ceil(range / C)
    for (let y = -n; y < n; y++) for (let x = -n; x < n; x++) cells.push(x, y, layer)
  }
  g.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cells), 3))
  g.instanceCount = cells.length / 3
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
  return g
}

/** Polar grid: rings from 0.5 m to 650 km (geometric), `segments` around. */
export function createRingGeometry(segments: number, growth: number) {
  const radii = [0]
  let r = 0.0005
  while (r < 650) {
    radii.push(r)
    r *= growth
  }
  radii.push(650)
  const nR = radii.length
  const polar = new Float32Array(nR * segments * 2)
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j < segments; j++) {
      const k = (i * segments + j) * 2
      polar[k] = radii[i]
      polar[k + 1] = (j / segments) * Math.PI * 2
    }
  }
  const index: number[] = []
  for (let i = 0; i < nR - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * segments + j
      const b = i * segments + ((j + 1) % segments)
      const c = (i + 1) * segments + j
      const d = (i + 1) * segments + ((j + 1) % segments)
      index.push(a, c, b, b, c, d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('polar', new THREE.BufferAttribute(polar, 2))
  // three needs a position attribute for bookkeeping; the shader ignores it
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nR * segments * 3), 3))
  g.setIndex(index)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
  return g
}
