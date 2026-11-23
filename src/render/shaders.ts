/** GLSL gölgelendiricileri (Three.js ShaderMaterial). */

export const earthVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Gündüz dokusu + gerçek zamanlı gece/gündüz sınırı + şehir ışıkları + atmosfer kenar parlaması. */
export const earthFragment = /* glsl */ `
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform vec3 uSunDir;
uniform float uHasDay;
uniform float uHasNight;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;

vec3 proceduralDay(vec2 uv) {
  // Doku bulunamazsa: lacivert küre + enlem/boylam ızgarası (gerçek kıyı çizgisi iddia etmez)
  vec2 g = abs(fract(vec2(uv.x * 24.0, uv.y * 12.0)) - 0.5);
  float line = 1.0 - smoothstep(0.0, 0.035, min(g.x, g.y));
  return mix(vec3(0.020, 0.055, 0.140), vec3(0.25, 0.38, 0.62), line * 0.55);
}

void main() {
  vec3 n = normalize(vNormalW);
  vec3 sun = normalize(uSunDir);
  float d = dot(n, sun);
  float light = smoothstep(-0.12, 0.30, d);
  float nightMask = 1.0 - smoothstep(-0.18, 0.06, d);

  vec3 day = uHasDay > 0.5 ? texture2D(uDay, vUv).rgb : proceduralDay(vUv);
  vec3 col = day * (0.035 + 1.05 * light);

  if (uHasNight > 0.5) {
    vec3 lights = texture2D(uNight, vUv).rgb;
    col += lights * vec3(1.0, 0.82, 0.55) * nightMask * 1.6;
  }

  // Alacakaranlık kuşağında hafif sıcak ton
  float dusk = exp(-pow(d * 7.0, 2.0));
  col += vec3(0.35, 0.14, 0.05) * dusk * 0.10;

  // Atmosfer kenar parlaması (Fresnel)
  vec3 viewDir = normalize(cameraPosition - vPosW);
  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  col += vec3(0.30, 0.55, 1.0) * fres * (0.10 + 0.55 * light);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const atmosphereVertex = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vNormalW;
void main() {
  vNormalV = normalize(normalMatrix * normal);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const atmosphereFragment = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vNormalV;
varying vec3 vNormalW;
void main() {
  float rim = pow(clamp(0.72 - dot(vNormalV, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0);
  float dayside = 0.25 + 0.75 * smoothstep(-0.35, 0.45, dot(normalize(vNormalW), normalize(uSunDir)));
  gl_FragColor = vec4(vec3(0.32, 0.58, 1.0) * rim * dayside * 1.6, 1.0);
}
`;

export const cloudsFragment = /* glsl */ `
uniform sampler2D uClouds;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  float c = texture2D(uClouds, vUv).r;
  float light = smoothstep(-0.10, 0.35, dot(normalize(vNormalW), normalize(uSunDir)));
  gl_FragColor = vec4(vec3(1.0) * (0.05 + 0.95 * light), c * 0.55 * (0.15 + 0.85 * light));
}
`;

/**
 * Uydu noktaları. Konumlar işçiden gelen SGP4 sonucu + aynı SGP4 hız vektörüyle
 * iki hesap arasındaki kısa süre için doğrusal ara değer (çevrimdışıyken uDt = 0).
 */
export const satVertex = /* glsl */ `
uniform float uDt;
uniform float uSize;
uniform float uPixelRatio;
attribute vec3 aVel;
attribute vec3 aColor;
attribute float aVis;
varying vec3 vColor;
void main() {
  vec3 p = position + aVel * uDt;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.001);
  float size = clamp(uSize * 9.0 / dist, 1.6, 7.0) * uPixelRatio;
  gl_PointSize = aVis > 0.5 ? size : 0.0;
  vColor = aColor;
}
`;

export const satFragment = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.30, r);
  gl_FragColor = vec4(vColor, a);
}
`;

export const markerVertex = /* glsl */ `
uniform float uPx;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uPx;
}
`;

/** Seçili uydu: kırmızı halka + beyaz merkez. */
export const markerFragment = /* glsl */ `
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float ring = smoothstep(0.50, 0.45, r) * smoothstep(0.30, 0.36, r);
  float core = smoothstep(0.16, 0.10, r);
  vec3 col = mix(vec3(0.988, 0.239, 0.129), vec3(1.0), core);
  gl_FragColor = vec4(col, max(ring, core));
}
`;
