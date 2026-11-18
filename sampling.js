// sampling.js — 足迹椭圆计算 + 点采样 / 各向同性 mip / 椭圆足迹滤波
"use strict";

// 由 2x2 Jacobian J（屏幕像素步长 -> 纹理 texel 步长）得到足迹椭圆。
// G = J * J^T 的特征值开方即椭圆半轴长（texel），特征向量给长轴方向。
function footprintEllipse(dudx, dudy, dvdx, dvdy) {
  const a = dudx * dudx + dvdx * dvdx;   // G[0][0]
  const b = dudx * dudy + dvdx * dvdy;   // G[0][1]
  const c = dudy * dudy + dvdy * dvdy;   // G[1][1]
  const tr = a + c;
  const det = a * c - b * b;
  const disc = Math.sqrt(Math.max(tr * tr * 0.25 - det, 0));
  let l1 = tr * 0.5 + disc;              // 较大特征值
  let l2 = tr * 0.5 - disc;              // 较小特征值
  l1 = Math.max(l1, 1e-12); l2 = Math.max(l2, 1e-12);
  const major = Math.sqrt(l1);           // 长半轴（texel/像素）
  const minor = Math.sqrt(l2);           // 短半轴
  // 长轴方向：l1 的特征向量
  let mx, my;
  if (Math.abs(b) > 1e-12) {
    mx = l1 - c; my = b;
  } else {
    mx = a >= c ? 1 : 0; my = a >= c ? 0 : 1;
  }
  const n = Math.hypot(mx, my) || 1;
  return { major, minor, dirX: mx / n, dirY: my / n, ratio: major / minor };
}

// 1) 点采样：固定 LOD 0 双线性
function samplePoint(tex, u, v) {
  return sampleLevel(tex.levels[0], u, v);
}

// 2) 各向同性 mip：按最长轴选层（标准做法），三线性
function sampleIsoMip(tex, u, v, ell) {
  const lod = Math.log2(Math.max(ell.major, 1));
  return sampleTrilinear(tex, lod, u, v);
}

// 3) 椭圆足迹滤波（Feline 式）：
//    按短轴选 mip 层，沿长轴在椭圆内取 N 个样本平均。
//    N 受预算 maxN 限制；不足时可选提升 LOD 补偿（模糊换抗混叠）。
//    返回 { value, usedN, needN, lod, clamped, offsets }
function sampleEllipseFilter(tex, u, v, ell, maxN, weightMode, lodComp) {
  let lod = Math.log2(Math.max(ell.minor, 1));
  const needN = Math.max(1, Math.ceil(ell.ratio));
  const usedN = Math.min(needN, maxN);
  const clamped = needN > maxN;
  if (clamped && lodComp) {
    // 预算不足：把剩余各向异性折进 LOD，长轴 footprint / N 决定新层
    lod = Math.log2(Math.max(ell.major / usedN, 1));
  }
  // 沿长轴均匀分布采样点，覆盖椭圆直径（±major texel）
  const offsets = [];
  let sum = 0, wsum = 0;
  for (let i = 0; i < usedN; i++) {
    const t = usedN === 1 ? 0 : (i / (usedN - 1)) * 2 - 1;   // [-1, 1]
    let w = 1;
    if (weightMode === "gauss") w = Math.exp(-2.5 * t * t);  // 截断高斯
    const ou = ell.dirX * ell.major * t;
    const ov = ell.dirY * ell.major * t;
    offsets.push({ du: ou, dv: ov, w });
    sum += w * sampleTrilinear(tex, lod, u + ou, v + ov);
    wsum += w;
  }
  return { value: sum / wsum, usedN, needN, lod, clamped, offsets };
}

// 参考解：在椭圆内做 16x16 抖动超采样（LOD 0），近似真实积分
function sampleReference(tex, u, v, ell) {
  const S = 16;
  let sum = 0, cnt = 0;
  for (let iy = 0; iy < S; iy++) {
    for (let ix = 0; ix < S; ix++) {
      // 单位圆内均匀点 -> 椭圆内点
      const px = ((ix + 0.5) / S) * 2 - 1;
      const py = ((iy + 0.5) / S) * 2 - 1;
      if (px * px + py * py > 1) continue;
      const du = ell.dirX * ell.major * px - ell.dirY * ell.minor * py;
      const dv = ell.dirY * ell.major * px + ell.dirX * ell.minor * py;
      sum += sampleLevel(tex.levels[0], u + du, v + dv);
      cnt++;
    }
  }
  return cnt ? sum / cnt : sampleLevel(tex.levels[0], u, v);
}
