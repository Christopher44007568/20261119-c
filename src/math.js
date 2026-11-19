// 最小三维数学库：向量为普通数组 [x,y,z]，4x4 矩阵为行优先 Float64Array(16)

export const EPS = 1e-8;

export function vec3(x = 0, y = 0, z = 0) {
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

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const len = length(a);
  if (len < EPS) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function negate(a) {
  return [-a[0], -a[1], -a[2]];
}

export function transformPoint(m, p) {
  const [x, y, z] = p;
  const w = m[12] * x + m[13] * y + m[14] * z + m[15];
  return [
    (m[0] * x + m[1] * y + m[2] * z + m[3]) / w,
    (m[4] * x + m[5] * y + m[6] * z + m[7]) / w,
    (m[8] * x + m[9] * y + m[10] * z + m[11]) / w,
  ];
}

// 不做透视除法（用于方向向量 / 已知 w=1 的情形）
export function transformVec4(m, p) {
  const [x, y, z, w] = p;
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3] * w,
    m[4] * x + m[5] * y + m[6] * z + m[7] * w,
    m[8] * x + m[9] * y + m[10] * z + m[11] * w,
    m[12] * x + m[13] * y + m[14] * z + m[15] * w,
  ];
}

export function multiply(a, b) {
  const out = new Float64Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[row * 4 + k] * b[k * 4 + col];
      }
      out[row * 4 + col] = sum;
    }
  }
  return out;
}

export function invert(m) {
  const inv = new Float64Array(16);
  const mat = Array.from({ length: 4 }, (_, r) =>
    Array.from({ length: 4 }, (_, c) => m[r * 4 + c])
  );
  const id = Array.from({ length: 4 }, (_, r) =>
    Array.from({ length: 4 }, (_, c) => (r === c ? 1 : 0))
  );
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let r = col + 1; r < 4; r++) {
      if (Math.abs(mat[r][col]) > Math.abs(mat[pivot][col])) pivot = r;
    }
    if (Math.abs(mat[pivot][col]) < 1e-12) {
      throw new Error('矩阵不可逆');
    }
    [mat[col], mat[pivot]] = [mat[pivot], mat[col]];
    [id[col], id[pivot]] = [id[pivot], id[col]];
    const div = mat[col][col];
    for (let c = 0; c < 4; c++) {
      mat[col][c] /= div;
      id[col][c] /= div;
    }
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const factor = mat[r][col];
      for (let c = 0; c < 4; c++) {
        mat[r][c] -= factor * mat[col][c];
        id[r][c] -= factor * id[col][c];
      }
    }
  }
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) inv[r * 4 + c] = id[r][c];
  }
  return inv;
}

// 右手系 lookAt（相机看向 -Z，与 OpenGL/Three.js 一致）
export function lookAt(eye, target, up) {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const m = new Float64Array(16);
  m[0] = x[0]; m[1] = x[1]; m[2] = x[2]; m[3] = 0;
  m[4] = y[0]; m[5] = y[1]; m[6] = y[2]; m[7] = 0;
  m[8] = z[0]; m[9] = z[1]; m[10] = z[2]; m[11] = 0;
  m[3] = -dot(x, eye);
  m[7] = -dot(y, eye);
  m[11] = -dot(z, eye);
  m[15] = 1;
  return m;
}

// 透视投影，NDC z 范围 [-1,1]
export function perspective(fovYRad, aspect, near, far) {
  const f = 1 / Math.tan(fovYRad / 2);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = (2 * far * near) / (near - far);
  m[14] = -1;
  m[15] = 0;
  return m;
}

// 正交投影，NDC z 范围 [-1,1]
export function ortho(left, right, bottom, top, near, far) {
  const m = new Float64Array(16);
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  m[10] = -2 / (far - near);
  m[15] = 1;
  m[3] = -(right + left) / (right - left);
  m[7] = -(top + bottom) / (top - bottom);
  m[11] = -(far + near) / (far - near);
  return m;
}

// 把完整 NDC 立方体 [-1,1]^3 映射到屏幕矩形对应的子盒（z 保持 [-1,1]）
export function ndcScaleBias(xmin, xmax, ymin, ymax) {
  const m = new Float64Array(16);
  m[0] = (xmax - xmin) / 2;
  m[5] = (ymax - ymin) / 2;
  m[10] = 1;
  m[3] = (xmax + xmin) / 2;
  m[7] = (ymax + ymin) / 2;
  m[15] = 1;
  return m;
}

// 轴角旋转（右手定则，axis 会被归一化）
export function axisAngle(axis, rad) {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const t = 1 - c;
  const m = new Float64Array(16);
  m[0] = t * x * x + c;
  m[1] = t * x * y + s * z;
  m[2] = t * x * z - s * y;
  m[4] = t * x * y - s * z;
  m[5] = t * y * y + c;
  m[6] = t * y * z + s * x;
  m[8] = t * x * z + s * y;
  m[9] = t * y * z - s * x;
  m[10] = t * z * z + c;
  m[15] = 1;
  return m;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
