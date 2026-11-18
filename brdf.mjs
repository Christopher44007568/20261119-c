// Anisotropic GGX (Heitz 2014 parameterization) for brushed metal.
// The tangent direction T defines the highlight stretch axis:
// roughnessX is measured along T, roughnessY along the bitangent B.

export function vec3(x = 0, y = 0, z = 0) {
  return [x, y, z];
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

export function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) throw new Error('cannot normalize near-zero vector');
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

// Orthonormalize a (possibly non-orthogonal) tangent against the normal.
export function makeFrame(n, t) {
  const nn = normalize(n);
  let tt = add(t, scale(nn, -dot(t, nn)));
  const len = Math.hypot(tt[0], tt[1], tt[2]);
  if (len < 1e-8) {
    // Degenerate tangent: pick any stable perpendicular axis.
    const ref = Math.abs(nn[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    tt = add(ref, scale(nn, -dot(ref, nn)));
  }
  tt = normalize(tt);
  const bb = normalize(cross(nn, tt));
  return { t: tt, b: bb, n: nn };
}

// Rotate a tangent around the normal by `angle` radians.
export function rotateTangent(n, t, angle) {
  const { t: tt, b: bb } = makeFrame(n, t);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(scale(tt, c), scale(bb, s));
}

// Tangent-space components of a world direction.
function toLocal(frame, w) {
  return [dot(w, frame.t), dot(w, frame.b), dot(w, frame.n)];
}

// Anisotropic GGX normal distribution function.
export function D(frame, ax, ay, h) {
  const [hx, hy, hz] = toLocal(frame, h);
  if (hz <= 0) return 0;
  const ax2 = ax * ax;
  const ay2 = ay * ay;
  const denom = (hx * hx) / ax2 + (hy * hy) / ay2 + hz * hz;
  return 1 / (Math.PI * ax * ay * denom * denom);
}

// Smith Lambda (one-sided masking-shadowing) for anisotropic GGX.
function lambda(frame, ax, ay, w) {
  const [wx, wy, wz] = toLocal(frame, w);
  if (wz <= 0) return Infinity;
  const term = (ax * wx) ** 2 + (ay * wy) ** 2;
  if (term < 1e-16) return 0;
  return (-1 + Math.sqrt(1 + term / (wz * wz))) / 2;
}

// Height-correlated Smith G2.
export function G2(frame, ax, ay, wi, wo) {
  const li = lambda(frame, ax, ay, wi);
  const lo = lambda(frame, ax, ay, wo);
  if (!Number.isFinite(li) || !Number.isFinite(lo)) return 0;
  return 1 / (1 + li + lo);
}

// Full specular BRDF (without Fresnel): D * G2 / (4 cos_i cos_o).
// wi: toward light, wo: toward viewer, both world-space unit vectors.
export function evalSpecular(n, t, ax, ay, wi, wo) {
  const frame = makeFrame(n, t);
  const h = normalize(add(wi, wo));
  const ni = dot(frame.n, wi);
  const no = dot(frame.n, wo);
  if (ni <= 0 || no <= 0) return 0;
  const d = D(frame, ax, ay, h);
  const g = G2(frame, ax, ay, wi, wo);
  return (d * g) / (4 * ni * no);
}

// Map (roughness, anisotropy in [0,1]) to (alphaX, alphaY) so that
// anisotropy = 0 gives an exactly isotropic lobe (alphaX === alphaY).
export function roughnessToAlpha(roughness, anisotropy) {
  const a = Math.max(roughness * roughness, 1e-3);
  const aspect = Math.sqrt(1 - 0.9 * Math.min(Math.max(anisotropy, 0), 1));
  return [a / aspect, a * aspect];
}
