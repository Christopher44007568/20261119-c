// 实数球谐（SH, l<=3, 16 系数）核心数学：投影、旋转、卷积。
// 与 tools/validate_sh.py 的公式一一对应。
"use strict";

const SH_MAX_L = 3;
const SH_N = 16;

// Lambertian 卷积系数 A_l（A_3 = 0：漫反射三阶无贡献）
const A_LAMBERT = [Math.PI, 2 * Math.PI / 3, Math.PI / 4, 0.0];

function shBasisInto(out, x, y, z) {
  out[0] = 0.28209479177387814;
  out[1] = 0.4886025119029199 * y;
  out[2] = 0.4886025119029199 * z;
  out[3] = 0.4886025119029199 * x;
  out[4] = 1.0925484305920792 * x * y;
  out[5] = 1.0925484305920792 * y * z;
  out[6] = 0.31539156525352005 * (3 * z * z - 1);
  out[7] = 1.0925484305920792 * x * z;
  out[8] = 0.5462742152960396 * (x * x - y * y);
  out[9] = 0.5900435899266435 * y * (3 * x * x - y * y);
  out[10] = 2.890611442640554 * x * y * z;
  out[11] = 0.4570457994644658 * y * (4 * z * z - x * x - y * y);
  out[12] = 0.3731763325901154 * z * (2 * z * z - 3 * x * x - 3 * y * y);
  out[13] = 0.4570457994644658 * x * (4 * z * z - x * x - y * y);
  out[14] = 1.445305721320277 * z * (x * x - y * y);
  out[15] = 0.5900435899266435 * x * (x * x - 3 * y * y);
  return out;
}

function fibonacciSphere(n) {
  const dirs = new Float64Array(n * 3);
  const golden = Math.PI * (1 + Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const phi = Math.acos(1 - 2 * t);
    const theta = golden * (i + 0.5);
    dirs[i * 3] = Math.sin(phi) * Math.cos(theta);
    dirs[i * 3 + 1] = Math.sin(phi) * Math.sin(theta);
    dirs[i * 3 + 2] = Math.cos(phi);
  }
  return dirs;
}

// 数值投影：c_i = ∫ L(w) Y_i(w) dw，envFn(dir[3]) -> [r,g,b]
function projectEnv(envFn, nSamples = 32768) {
  const dirs = fibonacciSphere(nSamples);
  const w = 4 * Math.PI / nSamples;
  const c = new Float64Array(SH_N * 3);
  const basis = new Float64Array(SH_N);
  for (let i = 0; i < nSamples; i++) {
    const d = [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]];
    const v = envFn(d);
    shBasisInto(basis, d[0], d[1], d[2]);
    for (let k = 0; k < SH_N; k++) {
      c[k * 3] += basis[k] * v[0] * w;
      c[k * 3 + 1] += basis[k] * v[1] * w;
      c[k * 3 + 2] += basis[k] * v[2] * w;
    }
  }
  return c;
}

// ---- 3x3 旋转矩阵（行主序 Float64Array(9)） ----

function rotAxisAngle(ax, ay, az, angle) {
  const len = Math.hypot(ax, ay, az);
  const x = ax / len, y = ay / len, z = az / len;
  const c = Math.cos(angle), s = Math.sin(angle), C = 1 - c;
  return new Float64Array([
    c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,
  ]);
}

// ---- SH 旋转矩阵：对带限函数精确的最小二乘构造 ----

const _ROT_DIRS = fibonacciSphere(64);

function _buildRotPinv() {
  // pinv(Y) = (Y^T Y)^-1 Y^T，Y 为 64x16 基矩阵
  const yty = new Float64Array(SH_N * SH_N);
  const yt = new Float64Array(SH_N * 64);
  const b = new Float64Array(SH_N);
  for (let j = 0; j < 64; j++) {
    shBasisInto(b, _ROT_DIRS[j * 3], _ROT_DIRS[j * 3 + 1], _ROT_DIRS[j * 3 + 2]);
    for (let p = 0; p < SH_N; p++) {
      yt[p * 64 + j] = b[p];
      for (let q = 0; q < SH_N; q++) yty[p * SH_N + q] += b[p] * b[q];
    }
  }
  const inv = matInvert(yty, SH_N);
  const pinv = new Float64Array(SH_N * 64);
  for (let p = 0; p < SH_N; p++)
    for (let j = 0; j < 64; j++)
      for (let q = 0; q < SH_N; q++)
        pinv[p * 64 + j] += inv[p * SH_N + q] * yt[q * 64 + j];
  return pinv;
}

const _ROT_PINV = _buildRotPinv(); // 16x64

// 返回 16x16 矩阵 D：c' = D c 对应环境旋转 L'(w) = L(R^-1 w)
function shRotationMatrix(rot) {
  const basisRot = new Float64Array(64 * SH_N);
  const b = new Float64Array(SH_N);
  for (let j = 0; j < 64; j++) {
    // 行向量 d @ R 即列向量 R^T d = R^-1 d
    const dx = _ROT_DIRS[j * 3], dy = _ROT_DIRS[j * 3 + 1], dz = _ROT_DIRS[j * 3 + 2];
    const rx = dx * rot[0] + dy * rot[3] + dz * rot[6];
    const ry = dx * rot[1] + dy * rot[4] + dz * rot[7];
    const rz = dx * rot[2] + dy * rot[5] + dz * rot[8];
    shBasisInto(b, rx, ry, rz);
    for (let p = 0; p < SH_N; p++) basisRot[j * SH_N + p] = b[p];
  }
  const D = new Float64Array(SH_N * SH_N);
  for (let p = 0; p < SH_N; p++)
    for (let q = 0; q < SH_N; q++)
      for (let j = 0; j < 64; j++)
        D[p * SH_N + q] += _ROT_PINV[p * 64 + j] * basisRot[j * SH_N + q];
  return D;
}

function shRotate(coefs, D) {
  const out = new Float64Array(SH_N * 3);
  for (let p = 0; p < SH_N; p++)
    for (let q = 0; q < SH_N; q++) {
      const d = D[p * SH_N + q];
      out[p * 3] += d * coefs[q * 3];
      out[p * 3 + 1] += d * coefs[q * 3 + 1];
      out[p * 3 + 2] += d * coefs[q * 3 + 2];
    }
  return out;
}

// 高斯消元求逆（小矩阵）
function matInvert(m, n) {
  const a = new Float64Array(n * 2 * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a[i * 2 * n + j] = m[i * n + j];
    a[i * 2 * n + n + i] = 1;
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(a[r * 2 * n + col]) > Math.abs(a[piv * 2 * n + col])) piv = r;
    for (let j = 0; j < 2 * n; j++) {
      const t = a[col * 2 * n + j];
      a[col * 2 * n + j] = a[piv * 2 * n + j];
      a[piv * 2 * n + j] = t;
    }
    const d = a[col * 2 * n + col];
    for (let j = 0; j < 2 * n; j++) a[col * 2 * n + j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r * 2 * n + col];
      for (let j = 0; j < 2 * n; j++) a[r * 2 * n + j] -= f * a[col * 2 * n + j];
    }
  }
  const inv = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) inv[i * n + j] = a[i * 2 * n + n + j];
  return inv;
}

// ---- 卷积缩放 ----

// 漫反射：E(n) = sum_l A_l sum_m c_lm Y_lm(n)，返回 16 项缩放
function lambertScale() {
  const s = new Float64Array(SH_N);
  for (let l = 0; l <= SH_MAX_L; l++)
    for (let m = 0; m < 2 * l + 1; m++) s[l * l + m] = A_LAMBERT[l];
  return s;
}

// 归一化 Phong 瓣 cos^n 的 zonal SH 系数 k_l（m=0）
function zonalPhongKernel(shininess, nSamples = 4096) {
  const k = new Float64Array(SH_MAX_L + 1);
  const b = new Float64Array(SH_N);
  let norm = 0;
  const vals = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    const z = (i + 0.5) / nSamples;
    vals[i] = Math.pow(z, shininess);
    norm += vals[i];
  }
  norm *= 2 * Math.PI / nSamples; // ∫k dω = 1
  for (let i = 0; i < nSamples; i++) {
    const z = (i + 0.5) / nSamples;
    shBasisInto(b, 0, 0, z);
    for (let l = 0; l <= SH_MAX_L; l++)
      k[l] += (vals[i] / norm) * b[l * l + l] * (2 * Math.PI / nSamples);
  }
  return k;
}

// 高光：E_spec(r) = sum_l lambda_l sum_m c_lm Y_lm(r)
// lambda_l = sqrt(4pi/(2l+1)) * k_l（与 Lambertian 的 A_l 同记号体系）
function specularScale(shininess) {
  const k = zonalPhongKernel(shininess);
  const s = new Float64Array(SH_N);
  for (let l = 0; l <= SH_MAX_L; l++) {
    const lam = Math.sqrt(4 * Math.PI / (2 * l + 1)) * k[l];
    for (let m = 0; m < 2 * l + 1; m++) s[l * l + m] = lam;
  }
  return s;
}

// 只保留前 order 阶（其余清零），用于阶数对比
function truncateOrder(coefs, order) {
  const n = (order + 1) * (order + 1);
  const out = new Float64Array(SH_N * 3);
  out.set(coefs.subarray(0, n * 3));
  return out;
}

// 高频残差：环境能量中被当前阶数 SH 表达的比例
function residualReport(envFn, coefs, nSamples = 16384) {
  const dirs = fibonacciSphere(nSamples);
  const w = 4 * Math.PI / nSamples;
  const b = new Float64Array(SH_N);
  let total = 0;
  const resid = [0, 0, 0, 0, 0]; // 按 L0..L3 的残差能量
  for (let i = 0; i < nSamples; i++) {
    const d = [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]];
    const v = envFn(d);
    shBasisInto(b, d[0], d[1], d[2]);
    total += (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) * w;
    let r = v[0], g = v[1], bl = v[2];
    for (let k = 0; k < SH_N; k++) {
      r -= b[k] * coefs[k * 3];
      g -= b[k] * coefs[k * 3 + 1];
      bl -= b[k] * coefs[k * 3 + 2];
      const bandEnd = (Math.floor(Math.sqrt(k)) + 1) ** 2 - 1;
      if (k === bandEnd) {
        const order = Math.floor(Math.sqrt(k));
        resid[order + 1] += (r * r + g * g + bl * bl) * w;
      }
    }
  }
  resid[0] = total;
  return resid.map(e => e / total); // [1.0, L0残差比, L1, L2, L3]
}
