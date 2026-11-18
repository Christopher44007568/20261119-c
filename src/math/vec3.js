// Minimal 3D vector / 3x3 rotation helpers used by the rigid-fold core.
// Vectors are plain [x, y, z] arrays; matrices are column-major 3x3 arrays.

export function v3(x = 0, y = 0, z = 0) {
  return [x, y, z];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function norm(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const n = norm(a);
  return n > 1e-12 ? scale(a, 1 / n) : [0, 0, 0];
}

export function neg(a) {
  return [-a[0], -a[1], -a[2]];
}

export function copy(a) {
  return [a[0], a[1], a[2]];
}

export function dist(a, b) {
  return norm(sub(a, b));
}

// Rodrigues rotation matrix (column-major) about unit axis k, angle theta.
export function rotMatrix(k, theta) {
  const [x, y, z] = k;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const t = 1 - c;
  // Row-major R first.
  const rows = [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * y * x + s * z, t * y * y + c, t * y * z - s * x],
    [t * z * x - s * y, t * z * y + s * x, t * z * z + c],
  ];
  // Convert to column-major.
  const m = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let cI = 0; cI < 3; cI++) {
      m[cI * 3 + r] = rows[r][cI];
    }
  }
  return m;
}

export function matMul(a, b) {
  // a, b column-major 3x3; returns a*b.
  const out = new Array(9);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      out[c * 3 + r] =
        a[0 * 3 + r] * b[c * 3 + 0] +
        a[1 * 3 + r] * b[c * 3 + 1] +
        a[2 * 3 + r] * b[c * 3 + 2];
    }
  }
  return out;
}

export function matVec(m, v) {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

export function identityMat() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

// Rigid transform: world = R * local + t.
export function identityTransform() {
  return { R: identityMat(), t: [0, 0, 0] };
}

export function applyXf(xf, p) {
  return add(matVec(xf.R, p), xf.t);
}

export function composeXf(parent, Rrel, trel) {
  // world = parent.R * (Rrel * local + trel) + parent.t
  return {
    R: matMul(parent.R, Rrel),
    t: add(matVec(parent.R, trel), parent.t),
  };
}
