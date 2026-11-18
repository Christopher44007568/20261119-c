// GLSL sources for the scene, water and debug-line programs.

export const SCENE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uProj, uView, uModel;
out vec3 vNormal;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uProj * uView * w;
}`;

export const SCENE_FS = `#version 300 es
precision mediump float;
in vec3 vNormal;
uniform vec3 uColor;
uniform float uAlpha;
out vec4 o;
void main() {
  vec3 n = normalize(vNormal);
  float d = max(dot(n, normalize(vec3(0.5, 0.8, 0.3))), 0.0);
  o = vec4(uColor * (0.25 + 0.75 * d), uAlpha);
}`;

export const WATER_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uProj, uView;
out vec3 vWorld;
void main() {
  vWorld = aPos;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

// Same wave field as src/water.mjs waveSlope(); geometry stays calm,
// only the reflection lookup is offset, then clamped into the water
// quad's screen-space footprint so samples never leave the surface.
export const WATER_FS = `#version 300 es
precision mediump float;
in vec3 vWorld;
uniform sampler2D uRefl;
uniform mat4 uReflVP;
uniform vec2 uFpMin, uFpMax;
uniform vec3 uCamPos;
uniform float uTime, uStrength;
uniform int uPerturb, uClamp;
out vec4 o;
vec2 waveSlope(vec2 p, float t) {
  vec2 s = vec2(0.0);
  s += vec2(1.0, 0.3) * (cos(dot(p, vec2(1.0, 0.3)) * 0.9 + t * 1.1) * 0.9 * 0.045);
  s += vec2(-0.6, 1.0) * (cos(dot(p, vec2(-0.6, 1.0)) * 1.7 + t * 1.6) * 1.7 * 0.028);
  s += vec2(0.8, -0.7) * (cos(dot(p, vec2(0.8, -0.7)) * 3.1 + t * 2.3) * 3.1 * 0.014);
  return s;
}
void main() {
  vec4 clip = uReflVP * vec4(vWorld, 1.0);
  vec2 uv0 = clip.xy / clip.w * 0.5 + 0.5;
  vec2 uv = uv0;
  if (uPerturb == 1) uv += waveSlope(vWorld.xz, uTime) * uStrength;
  if (uClamp == 1) uv = clamp(uv, uFpMin, uFpMax);
  vec3 refl = texture(uRefl, uv).rgb;
  vec3 deep = vec3(0.02, 0.10, 0.16);
  vec3 v = normalize(uCamPos - vWorld);
  float fres = 0.35 + 0.65 * pow(1.0 - max(v.y, 0.0), 3.0);
  o = vec4(mix(deep, refl, fres), 1.0);
}`;

export const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uProj, uView;
void main() { gl_Position = uProj * uView * vec4(aPos, 1.0); }`;

export const LINE_FS = `#version 300 es
precision mediump float;
uniform vec3 uColor;
out vec4 o;
void main() { o = vec4(uColor, 1.0); }`;
