// Rotation interpolation methods.
// Declared short-arc rule: every slerp segment takes the geodesic whose
// rotation angle is in [0, pi], by flipping q -> -q when dot < 0.

import { Q, dot, mul, normalize, neg } from "./quat.js";
import { fromEuler, toEuler, clamp } from "./convert.js";

export class Key {
  constructor(t, quat) {
    this.t = t;
    this.q = normalize(quat);
  }
}

export function makeKey(t, quat) {
  return new Key(t, quat);
}

// Quaternion log of a unit quaternion (pure-vector part scaled by angle).
export function logQ(a) {
  const n = normalize(a);
  const vlen = Math.hypot(n.x, n.y, n.z);
  if (vlen < 1e-12) return [0, 0, 0];
  const w = clamp(n.w, -1, 1);
  const angle = Math.acos(w);
  const k = angle / vlen;
  return [n.x * k, n.y * k, n.z * k];
}

export function expQ(v) {
  const angle = Math.hypot(v[0], v[1], v[2]);
  if (angle < 1e-12) return new Q(1, 0, 0, 0);
  const s = Math.sin(angle) / angle;
  return new Q(Math.cos(angle), v[0] * s, v[1] * s, v[2] * s);
}

// Relative rotation b * a^-1, forced onto the short-arc hemisphere (w >= 0).
export function shortArcDelta(a, b) {
  const d = mul(normalize(b), conjSafe(normalize(a)));
  return d.w < 0 ? neg(d) : d;
}

export function conjSafe(a) {
  return new Q(a.w, -a.x, -a.y, -a.z);
}

// Short-arc spherical linear interpolation. u in [0, 1].
export function slerp(a, b, u) {
  const qa = normalize(a);
  let qb = normalize(b);
  let d = dot(qa, qb);
  if (d < 0) {
    qb = neg(qb);
    d = -d;
  }
  if (d > 0.9995) {
    // Nearly identical: normalized linear blend is numerically stable.
    return normalize(new Q(
      qa.w + (qb.w - qa.w) * u,
      qa.x + (qb.x - qa.x) * u,
      qa.y + (qb.y - qa.y) * u,
      qa.z + (qb.z - qa.z) * u
    ));
  }
  const theta0 = Math.acos(clamp(d, -1, 1));
  const theta = theta0 * u;
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - d * Math.sin(theta) / sinTheta0;
  const s1 = Math.sin(theta) / sinTheta0;
  return new Q(
    s0 * qa.w + s1 * qb.w,
    s0 * qa.x + s1 * qb.x,
    s0 * qa.y + s1 * qb.y,
    s0 * qa.z + s1 * qb.z
  );
}

// Euler-angle linear interpolation. No wrap handling: shows the classic
// long-way/gimbal artifacts that quaternion interpolation avoids.
// Keys may carry an explicit raw Euler triple `e`; when present it is used
// verbatim (e.g. +190 deg stays distinct from the equivalent -170 deg).
export function eulerLerp(a, b, u, eaRaw = null, ebRaw = null) {
  const ea = eaRaw || toEuler(a);
  const eb = ebRaw || toEuler(b);
  const e = [
    ea[0] + (eb[0] - ea[0]) * u,
    ea[1] + (eb[1] - ea[1]) * u,
    ea[2] + (eb[2] - ea[2]) * u
  ];
  return fromEuler(e);
}

// Classic Shoemake/Eberly SQUAD control points, C1 in the uniform parameter:
// s_i = q_i * exp(-(log(q_i^-1 q_{i-1}) + log(q_i^-1 q_{i+1})) / 4).
// Both neighbor tangents keep their signed directions (no short-arc flip),
// which is what makes the C1 cancellation exact at every joint.
export function squadControls(keys) {
  const n = keys.length;
  const s = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) {
      s[i] = keys[i].q.clone();
      continue;
    }
    const qm = keys[i - 1].q;
    const q0 = keys[i].q;
    const qp = keys[i + 1].q;
    const v1 = logQ(mul(conjSafe(q0), qm));
    const v2 = logQ(mul(conjSafe(q0), qp));
    const v = [
      -0.25 * (v1[0] + v2[0]),
      -0.25 * (v1[1] + v2[1]),
      -0.25 * (v1[2] + v2[2])
    ];
    s[i] = mul(q0, expQ(v));
  }
  return s;
}

// One SQUAD segment between key i and i+1 (classic Shoemake form).
export function squadSegment(q0, q1, s0, s1, u) {
  const a = slerp(q0, q1, u);
  const b = slerp(s0, s1, u);
  return slerp(a, b, 2 * u * (1 - u));
}
