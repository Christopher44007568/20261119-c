// Conversions between quaternion, axis-angle, Euler angles and rotation matrix.
// Euler convention: intrinsic ZYX = extrinsic XYZ, angles [rollX, pitchY, yawZ].

import { Q, dot, normalize } from "./quat.js";

export function fromAxisAngle(axis, angle) {
  const [x, y, z] = normalize3(axis);
  const h = angle * 0.5;
  const s = Math.sin(h);
  return new Q(Math.cos(h), x * s, y * s, z * s);
}

export function toAxisAngle(a) {
  const n = normalize(a);
  const c = clamp(n.w, -1, 1);
  const angle = 2 * Math.acos(c);
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  if (s < 1e-10) {
    return { axis: [1, 0, 0], angle: 0 };
  }
  return { axis: [n.x / s, n.y / s, n.z / s], angle };
}

// Intrinsic ZYX (yaw Z, pitch Y, roll X) -> quaternion.
export function fromEuler([roll, pitch, yaw]) {
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  return new Q(
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy
  );
}

// Quaternion -> intrinsic ZYX Euler angles. Handles the pitch = +/-90 deg lock.
export function toEuler(a) {
  const n = normalize(a);
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = toMatrix(n);
  const p = Math.asin(clamp(-r20, -1, 1));
  if (Math.abs(Math.cos(p)) > 1e-9) {
    return [Math.atan2(r21, r22), p, Math.atan2(r10, r00)];
  }
  // Gimbal lock: yaw is arbitrary, fold it into roll.
  return [Math.atan2(-r01, r11), p, 0];
}

// Column-major 3x3 rotation matrix [m00,m10,m20, m01,m11,m21, m02,m12,m22].
export function toMatrix(a) {
  const n = normalize(a);
  const { w, x, y, z } = n;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy),
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx),
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy)
  ];
}

export function matrixToQuat(m) {
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = m;
  const t = m00 + m11 + m22;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    return normalize(new Q(0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s));
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normalize(new Q((m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s));
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normalize(new Q((m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s));
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normalize(new Q((m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s));
}

export function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

// Quaternion -> rotation angle (radians, in [0, pi]).
export function angleBetween(a, b) {
  const d = clamp(Math.abs(dot(normalize(a), normalize(b))), 0, 1);
  return 2 * Math.acos(d);
}
