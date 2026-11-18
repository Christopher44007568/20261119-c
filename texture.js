// texture.js — 程序化纹理 + mipmap 链 + 双线性采样（repeat 环绕）
"use strict";

const TEX_SIZE = 512;

// 生成高频棋盘：每格 4 texel，含细微亮度扰动避免过于"干净"
function genChecker(size) {
  const d = new Float32Array(size * size);
  const cell = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = ((x / cell | 0) + (y / cell | 0)) & 1;
      const jitter = 0.04 * Math.sin(x * 0.7) * Math.sin(y * 1.3);
      d[y * size + x] = (c ? 0.92 : 0.08) + jitter;
    }
  }
  return d;
}

// 生成斜向条纹：45° 方向，周期 8 texel，近似方波
function genStripes(size) {
  const d = new Float32Array(size * size);
  const period = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = ((x + y) % period + period) % period;
      d[y * size + x] = t < period / 2 ? 0.9 : 0.1;
    }
  }
  return d;
}

// 逐级 box 滤波构建 mip 链，返回 [{size, data}, ...]
function buildMips(base, size) {
  const levels = [{ size, data: base }];
  let cur = base, s = size;
  while (s > 1) {
    const h = s >> 1;
    const next = new Float32Array(h * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < h; x++) {
        const i = (y * 2) * s + x * 2;
        next[y * h + x] = (cur[i] + cur[i + 1] + cur[i + s] + cur[i + s + 1]) * 0.25;
      }
    }
    levels.push({ size: h, data: next });
    cur = next; s = h;
  }
  return levels;
}

function makeTexture(kind) {
  const base = kind === "stripes" ? genStripes(TEX_SIZE) : genChecker(TEX_SIZE);
  return { kind, levels: buildMips(base, TEX_SIZE) };
}

// 双线性采样，uv 单位是 texel（level 0 坐标系），repeat 环绕
function sampleLevel(level, u, v) {
  const s = level.size, d = level.data;
  let x = u - 0.5, y = v - 0.5;
  let x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const x1 = x0 + 1, y1 = y0 + 1;
  x0 = ((x0 % s) + s) % s; y0 = ((y0 % s) + s) % s;
  const x1w = x1 % s, y1w = y1 % s;
  const i00 = y0 * s + x0, i10 = y0 * s + x1w;
  const i01 = y1w * s + x0, i11 = y1w * s + x1w;
  const top = d[i00] + (d[i10] - d[i00]) * fx;
  const bot = d[i01] + (d[i11] - d[i01]) * fx;
  return top + (bot - top) * fy;
}

// 三线性：lod 可为小数，在相邻两层间插值
function sampleTrilinear(tex, lod, u, v) {
  const maxLod = tex.levels.length - 1;
  const l = Math.min(Math.max(lod, 0), maxLod);
  const l0 = Math.floor(l), l1 = Math.min(l0 + 1, maxLod);
  const f = l - l0;
  const s0 = tex.levels[l0].size, s1 = tex.levels[l1].size;
  const a = sampleLevel(tex.levels[l0], u / (TEX_SIZE / s0), v / (TEX_SIZE / s0));
  if (f === 0 || l0 === l1) return a;
  const b = sampleLevel(tex.levels[l1], u / (TEX_SIZE / s1), v / (TEX_SIZE / s1));
  return a + (b - a) * f;
}
