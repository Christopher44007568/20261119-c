// 环境定义（JS 侧，用于投影/验证；GLSL 侧通过 uniform 保持一致）。
"use strict";

const SPOT_DIR = (() => {
  const v = [0.4, 0.6, 0.693];
  const l = Math.hypot(...v);
  return v.map(x => x / l);
})();
const SPOT_COLOR = [1.0, 0.85, 0.6];
const SPOT_EXP = 6.0; // 宽光斑

// 高频环境：24 个窄小彩色光斑（确定性生成，便于复现）
const HF_LOBES = (() => {
  const dirs = fibonacciSphere(24);
  const lobes = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 24; i++) {
    lobes.push({
      dir: [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]],
      col: [0.4 + 0.6 * rand(), 0.4 + 0.6 * rand(), 0.4 + 0.6 * rand()],
    });
  }
  return lobes;
})();
const HF_EXP = 400.0;
const HF_GAIN = 6.0;

function envConstant() {
  return [1, 1, 1];
}

function envSpot(d) {
  const c = Math.max(0, d[0] * SPOT_DIR[0] + d[1] * SPOT_DIR[1] + d[2] * SPOT_DIR[2]);
  const l = Math.pow(c, SPOT_EXP);
  return [0.05 + l * SPOT_COLOR[0], 0.05 + l * SPOT_COLOR[1], 0.05 + l * SPOT_COLOR[2]];
}

function envHighFreq(d) {
  let r = 0.02, g = 0.02, b = 0.02;
  for (const { dir, col } of HF_LOBES) {
    const c = Math.max(0, d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2]);
    const l = Math.pow(c, HF_EXP) * HF_GAIN;
    r += l * col[0];
    g += l * col[1];
    b += l * col[2];
  }
  return [r, g, b];
}

const ENVS = { constant: envConstant, spot: envSpot, highfreq: envHighFreq };
