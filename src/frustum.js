// 选择体：透视下为六面平截头体，正交下为凸六面体（长方体）
// 平面统一表示为 { normal:[x,y,z], d }，内部点满足 dot(normal,p)+d >= 0

import { dot, invert, multiply, normalize, transformVec4 } from './math.js';

function extractPlanes(m) {
  // 行主序矩阵：行 i 的元素为 m[i*4 .. i*4+3]
  const r0 = [m[0], m[1], m[2], m[3]];
  const r1 = [m[4], m[5], m[6], m[7]];
  const r2 = [m[8], m[9], m[10], m[11]];
  const r3 = [m[12], m[13], m[14], m[15]];
  const raw = [
    [add3(r3, r0), '左平面 (x=-1)'],
    [sub3(r3, r0), '右平面 (x=+1)'],
    [add3(r3, r1), '下平面 (y=-1)'],
    [sub3(r3, r1), '上平面 (y=+1)'],
    [add3(r3, r2), '近平面 (z=-1)'],
    [sub3(r3, r2), '远平面 (z=+1)'],
  ];
  return raw.map(([v, label]) => {
    const n = normalize([v[0], v[1], v[2]]);
    const len = Math.hypot(v[0], v[1], v[2]);
    return { normal: n, d: v[3] / len, label };
  });
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
}
function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
}

export class Frustum {
  // worldMatrix: 把选择体局部 NDC 立方体 [-1,1]^3 映射到世界的矩阵
  // clipMatrix: 把世界点映射到选择体裁剪坐标的矩阵（worldMatrix 的逆）
  constructor(worldMatrix, clipMatrix, { isOrtho = false, ndcRect = null } = {}) {
    this.worldMatrix = worldMatrix;
    this.clipMatrix = clipMatrix;
    this.isOrtho = isOrtho;
    this.ndcRect = ndcRect;
    this.planes = extractPlanes(clipMatrix);
    this._corners = null;
  }

  corners() {
    if (this._corners) return this._corners;
    const out = [];
    for (let i = 0; i < 8; i++) {
      const ndc = [
        (i & 1) ? 1 : -1,
        (i & 2) ? 1 : -1,
        (i & 4) ? 1 : -1,
        1,
      ];
      const w = transformVec4(this.worldMatrix, ndc);
      out.push([w[0] / w[3], w[1] / w[3], w[2] / w[3]]);
    }
    this._corners = out;
    return out;
  }

  // 点在选择体内（含边界）
  containsPoint(p, eps = 1e-8) {
    return this.planes.every((pl) => dot(pl.normal, p) + pl.d >= -eps);
  }

  // 世界点 -> 选择体 NDC 坐标
  toNDC(p) {
    const q = transformVec4(this.clipMatrix, [p[0], p[1], p[2], 1]);
    return [q[0] / q[3], q[1] / q[3], q[2] / q[3]];
  }

  // 12 条边
  static EDGES = [
    [0, 1], [1, 3], [3, 2], [2, 0],
    [4, 5], [5, 7], [7, 6], [6, 4],
    [0, 4], [1, 5], [3, 7], [2, 6],
  ];

  // 6 个四边形面（角点索引），用于渲染
  static FACES = [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
  ];
}

// 由相机 view/proj 与屏幕 NDC 矩形构造选择体。
//
// 关键：屏幕矩形只覆盖相机 NDC 的一个子盒 [xmin,xmax]×[ymin,ymax]。
// 不能简单地用 bias 矩阵左乘投影矩阵——bias 的平移项在透视除法前作用会被 w 缩放，
// 破坏齐次关系。正确做法是把 NDC 重映射
//   sel_x = (cam_ndc_x - cx)/hx,  sel_y = (cam_ndc_y - cy)/hy
// 吸收进投影矩阵：由于 cam_ndc = clip/clip_w，
//   sel_clip_x = (1/hx)*clip_x - (cx/hx)*clip_w
// 即新投影矩阵的行 0/1 由原行 0/1 与 w 行（行 3）线性组合得到。
export function buildFrustum(viewMatrix, projMatrix, isOrtho, ndcRect) {
  const { xmin, xmax, ymin, ymax } = ndcRect;
  const hx = (xmax - xmin) / 2;
  const cx = (xmax + xmin) / 2;
  const hy = (ymax - ymin) / 2;
  const cy = (ymax + ymin) / 2;
  const ax = 1 / hx;
  const ox = -cx / hx;
  const ay = 1 / hy;
  const oy = -cy / hy;

  const adjustedProj = new Float64Array(projMatrix);
  // 行主序：w 行为行 3（索引 12..15）
  const wRow = [
    projMatrix[12], projMatrix[13], projMatrix[14], projMatrix[15],
  ];
  for (let c = 0; c < 4; c++) {
    adjustedProj[0 * 4 + c] = ax * projMatrix[0 * 4 + c] + ox * wRow[c];
    adjustedProj[1 * 4 + c] = ay * projMatrix[1 * 4 + c] + oy * wRow[c];
  }
  const clip = multiply(adjustedProj, viewMatrix);
  const world = invert(clip);
  return new Frustum(world, clip, { isOrtho, ndcRect });
}
