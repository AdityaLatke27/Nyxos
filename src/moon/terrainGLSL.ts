/**
 * Shared GLSL for sampling the lunar elevation pyramid.
 *
 * Levels (fine -> coarse): L0 SLDEM2015 59 m, L1 SLDEM2015 237 m,
 * L2 LOLA 948 m, global LOLA 2.67 km. All maps are lat/lon grids with row 0
 * at the north edge. A finer level is blended in only where it covers the
 * point and only while the requested footprint (lodKm) is smaller than the
 * next-coarser texel, so far views never pay for — or alias on — fine data.
 *
 * The same lookup is used for both heights (km) and baked sun visibility,
 * via the TERRAIN_LOOKUP macro.
 */

export const terrainUniformsGLSL = /* glsl */ `
  #define PI 3.141592653589793
  #define TAU 6.283185307179586
  uniform float uRadiusKm;
  uniform float uHeightScale;
  uniform vec4 uGlobalInfo; // (_, _, _, texelKm)
  uniform vec4 uL0Info;     // (latC, lonC, halfExtent rad, texelKm)
  uniform vec4 uL1Info;
  uniform vec4 uL2Info;
  uniform sampler2D uGlobalH;
  uniform sampler2D uL0H;
  uniform sampler2D uL1H;
  uniform sampler2D uL2H;
`

export const terrainFunctionsGLSL = /* glsl */ `
  vec2 globalUV(float lat, float lon) {
    return vec2(lon / TAU, 0.5 - lat / PI);
  }

  vec2 patchUV(vec4 info, float lat, float lon) {
    return vec2((lon - info.y) / (2.0 * info.z) + 0.5, (info.x - lat) / (2.0 * info.z) + 0.5);
  }

  float patchWeight(vec2 uv) {
    vec2 e = min(uv, 1.0 - uv);
    return smoothstep(0.0, 0.06, min(e.x, e.y));
  }

  float detailWeight(float lodKm, float coarserTexelKm) {
    return 1.0 - smoothstep(0.5 * coarserTexelKm, coarserTexelKm, lodKm);
  }

  // Cubic B-spline weights; sampled with 4 bilinear taps (Sigg & Hadwiger 2005).
  vec4 bsplineWeights(float v) {
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
    vec4 xc = bsplineWeights(f.x);
    vec4 yc = bsplineWeights(f.y);
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

  /** Trilinear when minified or near native; smooth B-spline when magnified, so
   *  slopes and shadow edges stay continuous instead of faceting per texel. */
  float sampleLevel(sampler2D t, vec2 uv, float lodKm, float texelKm) {
    float m = log2(max(lodKm, 1e-5) / texelKm);
    if (m > -0.4) return textureLod(t, uv, max(m, 0.0)).r;
    float cubic = sampleBicubic(t, uv);
    if (m < -1.0) return cubic;
    return mix(cubic, textureLod(t, uv, 0.0).r, (m + 1.0) / 0.6);
  }

  #define TERRAIN_LOOKUP(NAME, TG, T0, T1, T2)                                        \\
  float NAME(float lat, float lon, float lodKm) {                                     \\
    float v = sampleLevel(TG, globalUV(lat, lon), lodKm, uGlobalInfo.w);              \\
    float dw = detailWeight(lodKm, uGlobalInfo.w);                                    \\
    if (dw <= 0.0) return v;                                                          \\
    vec2 uv = patchUV(uL2Info, lat, lon);                                             \\
    float w = patchWeight(uv) * dw;                                                   \\
    if (w <= 0.0) return v;                                                           \\
    v = mix(v, sampleLevel(T2, uv, lodKm, uL2Info.w), w);                             \\
    uv = patchUV(uL1Info, lat, lon);                                                  \\
    w = patchWeight(uv) * detailWeight(lodKm, uL2Info.w);                             \\
    if (w <= 0.0) return v;                                                           \\
    v = mix(v, sampleLevel(T1, uv, lodKm, uL1Info.w), w);                             \\
    uv = patchUV(uL0Info, lat, lon);                                                  \\
    w = patchWeight(uv) * detailWeight(lodKm, uL1Info.w);                             \\
    if (w <= 0.0) return v;                                                           \\
    return mix(v, sampleLevel(T0, uv, lodKm, uL0Info.w), w);                          \\
  }

  TERRAIN_LOOKUP(heightKm, uGlobalH, uL0H, uL1H, uL2H)

  vec2 latLon(vec3 p) {
    return vec2(asin(clamp(p.y, -1.0, 1.0)), atan(p.x, p.z));
  }

  /** Terrain normal (scene frame) at unit direction P from height finite differences. */
  vec3 terrainNormal(vec3 P, float lat, float lon, float dKm) {
    float cl = max(cos(lat), 0.02);
    float dLat = dKm / uRadiusKm;
    float dLon = dKm / (uRadiusKm * cl);
    float hE = heightKm(lat, lon + dLon, dKm);
    float hW = heightKm(lat, lon - dLon, dKm);
    float hN = heightKm(lat + dLat, lon, dKm);
    float hS = heightKm(lat - dLat, lon, dKm);
    float s = uHeightScale / (2.0 * dKm);
    float dhdE = (hE - hW) * s;
    float dhdN = (hN - hS) * s;
    vec3 east = vec3(cos(lon), 0.0, -sin(lon));
    vec3 north = vec3(-sin(lat) * sin(lon), cos(lat), -sin(lat) * cos(lon));
    return normalize(P - dhdE * east - dhdN * north);
  }
`

export const visibilityUniformsGLSL = /* glsl */ `
  uniform sampler2D uGlobalV;
  uniform sampler2D uL0V;
  uniform sampler2D uL1V;
  uniform sampler2D uL2V;
`

export const visibilityFunctionsGLSL = /* glsl */ `
  TERRAIN_LOOKUP(sunVisibility, uGlobalV, uL0V, uL1V, uL2V)
`
