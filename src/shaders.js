export const SIMULATION_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aVelocity;
layout(location = 2) in vec2 aLife;
layout(location = 3) in vec4 aColor;
layout(location = 4) in float aGeneration;

uniform float uDt;
uniform float uTime;
uniform vec2 uPointer;
uniform float uPointerActive;

out vec3 vPosition;
out vec3 vVelocity;
out vec2 vLife;
out vec4 vColor;
out float vGeneration;

void main() {
  vec3 position = aPosition;
  vec3 velocity = aVelocity;
  vec2 life = aLife;

  if (life.x > 0.0) {
    float phase = aColor.w * 18.0 + aGeneration * 0.73;
    float swirl = sin(uTime * 1.12 + position.y * 2.25 + phase) * 0.39
      + cos(uTime * 0.63 + position.x * 3.1 - phase) * 0.15;

    velocity.x += swirl * uDt;
    velocity.z += cos(uTime * 0.82 + position.y * 1.5 + phase) * 0.11 * uDt;
    velocity.y -= 0.245 * uDt;

    vec2 away = position.xy - uPointer;
    float distanceToPointer = length(away);
    if (uPointerActive > 0.5 && distanceToPointer < 0.42) {
      velocity.xy += normalize(away + vec2(0.0001)) * (0.42 - distanceToPointer) * 2.8 * uDt;
    }

    velocity *= exp(-0.19 * uDt);
    position += velocity * uDt;
    life.x = max(0.0, life.x - uDt);
  }

  gl_Position = vec4(position, 1.0);
  vPosition = position;
  vVelocity = velocity;
  vLife = life;
  vColor = aColor;
  vGeneration = aGeneration;
}
`;

export const SIMULATION_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
out vec4 outColor;
void main() {
  outColor = vec4(1.0);
}
`;

export const RENDER_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aVelocity;
layout(location = 2) in vec2 aLife;
layout(location = 3) in vec4 aColor;
layout(location = 4) in float aGeneration;

uniform float uAspect;
uniform float uDpr;

out vec3 vColor;
out float vCore;

void main() {
  if (aLife.x <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }

  float lifeRatio = clamp(aLife.x / max(aLife.y, 0.0001), 0.0, 1.0);
  float depth = clamp(aPosition.z, -0.65, 0.65);
  float depthScale = 1.0 + depth * 0.33;
  vec2 clipPosition = vec2(
    aPosition.x / max(uAspect, 0.3) * 0.92,
    aPosition.y * 0.84
  );

  vec3 body = aColor.rgb;
  vec3 hot = mix(vec3(0.84, 1.0, 0.96), body, 0.54);
  vec3 tail = mix(body * 0.24, body, smoothstep(0.0, 0.52, lifeRatio));
  vColor = mix(tail, hot, smoothstep(0.58, 1.0, lifeRatio));
  vCore = aColor.w;

  gl_Position = vec4(clipPosition, 0.0, 1.0);
  gl_PointSize = clamp(
    (2.15 + aColor.w * 1.55 + lifeRatio * 1.15) * depthScale * uDpr,
    1.2 * uDpr,
    7.5 * uDpr
  );
}
`;

export const RENDER_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vColor;
in float vCore;
out vec4 outColor;

void main() {
  vec2 centered = gl_PointCoord * 2.0 - 1.0;
  float radiusSquared = dot(centered, centered);
  if (radiusSquared > 1.0) discard;

  float edge = smoothstep(1.0, 0.42, radiusSquared);
  float core = smoothstep(0.35, 0.0, radiusSquared);
  vec3 color = vColor * (0.72 + edge * 0.42);
  color += vec3(0.22, 0.34, 0.31) * core * vCore;

  outColor = vec4(color, 1.0);
}
`;
