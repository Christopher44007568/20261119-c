// Minimal column-major mat4 / vec3 helpers plus reflection-pass math.
// Shared by the WebGL demo (browser) and the Node unit tests.

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function lookAt(eye, center, up) {
  const z = normalize(sub(eye, center));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  m[15] = 1;
  return m;
}

export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function transformPoint(m, p) {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

// Project a world point to texture UV in [0,1] via view*proj. Null behind camera.
export function projectToUV(proj, view, p) {
  const v = multiply(proj, view);
  const [x, y, z] = p;
  const cw = v[3] * x + v[7] * y + v[11] * z + v[15];
  if (cw <= 1e-6) return null;
  const cx = v[0] * x + v[4] * y + v[8] * z + v[12];
  const cy = v[1] * x + v[5] * y + v[9] * z + v[13];
  return [cx / cw * 0.5 + 0.5, cy / cw * 0.5 + 0.5];
}

// --- reflection / oblique clip plane ---

// Reflect a point across plane n·x + d = 0 (|n| = 1).
export function reflectPoint(p, n, d) {
  const s = dot(n, p) + d;
  return sub(p, scale(n, 2 * s));
}

// Mirror camera across the water plane: reflect eye/center/up, rebuild lookAt.
export function mirrorView(eye, center, up, n, d) {
  const me = reflectPoint(eye, n, d);
  const mc = reflectPoint(center, n, d);
  const mu = sub(reflectPoint(add(eye, up), n, d), me);
  return lookAt(me, mc, mu);
}

// Transform plane (n, d) into view space of a rigid lookAt view matrix.
export function planeToView(view, n, d) {
  const rn = [
    view[0] * n[0] + view[4] * n[1] + view[8] * n[2],
    view[1] * n[0] + view[5] * n[1] + view[9] * n[2],
    view[2] * n[0] + view[6] * n[1] + view[10] * n[2],
  ];
  const t = [view[12], view[13], view[14]];
  return { n: rn, d: d - dot(rn, t) };
}

// Lengyel oblique near-plane clipping. clip: {n, d} in view space, camera must
// sit on the negative side. Returns a modified copy of proj.
export function makeOblique(proj, clip) {
  const p = Float32Array.from(proj);
  const c = [clip.n[0], clip.n[1], clip.n[2], clip.d];
  const q = [
    (sgn(c[0]) + p[8]) / p[0],
    (sgn(c[1]) + p[9]) / p[5],
    -1,
    (1 + p[10]) / p[14],
  ];
  const s = 2 / (c[0] * q[0] + c[1] * q[1] + c[2] * q[2] + c[3] * q[3]);
  p[2] = c[0] * s;
  p[6] = c[1] * s;
  p[10] = c[2] * s + 1;
  p[14] = c[3] * s;
  return p;
}

// Signed distance of a world point from the water plane.
export function planeSide(p, n, d) {
  return dot(n, p) + d;
}

// --- vec3 ---

export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export function sgn(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }
