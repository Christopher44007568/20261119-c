// Quaternion math (Hamilton convention, q = w + xi + yj + zk).
// Unit quaternions represent rotations: v' = q * v * q^-1.
// Works in both Node (ES module) and the browser.

export const EPS = 1e-10;

export class Q {
  constructor(w = 1, x = 0, y = 0, z = 0) {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
  }
  clone() {
    return new Q(this.w, this.x, this.y, this.z);
  }
}

export const q = (w, x, y, z) => new Q(w, x, y, z);

export function dot(a, b) {
  return a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
}

export function norm(a) {
  return Math.hypot(a.w, a.x, a.y, a.z);
}

export function normalize(a) {
  const n = norm(a);
  if (n < EPS) return new Q(1, 0, 0, 0);
  return new Q(a.w / n, a.x / n, a.y / n, a.z / n);
}

export function neg(a) {
  return new Q(-a.w, -a.x, -a.y, -a.z);
}

export function conj(a) {
  return new Q(a.w, -a.x, -a.y, -a.z);
}

// Hamilton product a * b
export function mul(a, b) {
  return new Q(
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
  );
}

export function inverse(a) {
  const n2 = dot(a, a);
  return new Q(a.w / n2, -a.x / n2, -a.y / n2, -a.z / n2);
}

// Rotate a 3D vector [x, y, z] by unit quaternion a.
export function rotateVec(a, v) {
  const qv = new Q(0, v[0], v[1], v[2]);
  const r = mul(mul(a, qv), conj(a));
  return [r.x, r.y, r.z];
}
