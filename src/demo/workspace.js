export const demoFiles = {
  "shaders/scene.vert": `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`,

  "shaders/scene.frag": `#version 300 es
precision highp float;
#include "lib/common.glsl"

uniform float uTime;
uniform vec2 uResolution;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= uResolution.x / uResolution.y;
  float t = uTime * 0.16;
  float flow = noise(vec2(p.x * 1.4 + t, p.y * 1.8 - t * 0.45));
  float detail = noise(p * 3.2 + vec2(-t * 0.7, t * 0.25));
  float ribbon = smoothstep(0.58, 0.96, 0.5 + 0.5 * sin((p.y + flow * 0.7) * 2.8 + t * 2.6));
  float halo = exp(-abs(p.y + flow * 0.22) * 3.4) * (0.5 + detail * 0.8);
  vec3 color = palette(0.54 + flow * 0.11 + t * 0.035);
  color *= 0.16 + ribbon * 0.72 + halo * 0.62;

  float gridX = smoothstep(0.97, 1.0, abs(fract(p.x * 3.0 + t) * 2.0 - 1.0));
  float gridY = smoothstep(0.97, 1.0, abs(fract(p.y * 3.0 - t * 0.5) * 2.0 - 1.0));
  color += vec3(0.08, 0.13, 0.22) * max(gridX, gridY) * 0.27;
  color += vec3(0.01, 0.015, 0.03);
  outColor = vec4(color, 1.0);
}`,

  "shaders/overlay.vert": `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`,

  "shaders/overlay.frag": `#version 300 es
precision highp float;
#include "lib/common.glsl"

uniform float uTime;
uniform vec2 uResolution;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float scan = 0.5 + 0.5 * sin(vUv.y * uResolution.y * 1.15 + uTime * 2.4);
  float grain = hash21(floor(vUv * uResolution * 0.7) + uTime);
  float vignette = smoothstep(1.25, 0.38, length(p * vec2(0.82, 1.0)));
  float edge = smoothstep(0.035, 0.0, abs(abs(p.x) - 0.84));
  vec3 tint = vec3(0.34, 0.82, 0.95);
  float alpha = scan * 0.018 + (1.0 - vignette) * 0.24 + edge * 0.07 + grain * 0.008;
  outColor = vec4(tint, alpha);
}`,

  "shaders/lib/common.glsl": `#pragma once

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 palette(float t) {
  vec3 a = vec3(0.08, 0.18, 0.32);
  vec3 b = vec3(0.28, 0.62, 0.82);
  vec3 c = vec3(1.0, 0.72, 0.45);
  vec3 d = vec3(0.00, 0.18, 0.46);
  return a + b * cos(6.28318 * (c * t + d));
}`,
};

export const demoPrograms = [
  {
    id: "scene",
    label: "Aurora scene",
    vertex: "shaders/scene.vert",
    fragment: "shaders/scene.frag",
    drawOrder: 0,
  },
  {
    id: "overlay",
    label: "Glass overlay",
    vertex: "shaders/overlay.vert",
    fragment: "shaders/overlay.frag",
    drawOrder: 1,
  },
];
