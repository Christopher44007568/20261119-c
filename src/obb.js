// 定向包围盒（Oriented Bounding Box）：中心 + 三个正交轴 + 半尺寸

import { add, dot, normalize, scale, sub, transformPoint } from './math.js';

export class OBB {
  constructor(name, center, axes, halfExtents, color = '#7ec8ff') {
    this.name = name;
    this.center = center;
    this.axes = axes.map((a) => normalize(a));
    this.halfExtents = halfExtents.slice();
    this.color = color;
  }

  // 8 个角点，顺序与单位立方体一致
  corners() {
    const out = [];
    for (let i = 0; i < 8; i++) {
      let p = this.center.slice();
      for (let k = 0; k < 3; k++) {
        const sign = (i >> k) & 1 ? 1 : -1;
        p = add(p, scale(this.axes[k], sign * this.halfExtents[k]));
      }
      out.push(p);
    }
    return out;
  }

  // 12 条边，每条为两个角点索引
  static EDGES = [
    [0, 1], [1, 3], [3, 2], [2, 0],
    [4, 5], [5, 7], [7, 6], [6, 4],
    [0, 4], [1, 5], [3, 7], [2, 6],
  ];

  static FACES = [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
  ];

  // 点是否在 OBB 内部（含边界，容差 eps）
  containsPoint(p, eps = 1e-8) {
    const d = sub(p, this.center);
    for (let k = 0; k < 3; k++) {
      if (Math.abs(dot(d, this.axes[k])) > this.halfExtents[k] + eps) return false;
    }
    return true;
  }

  // 12 个三角面（用于独立 oracle 的线段-三角形求交）
  triangles() {
    const c = this.corners();
    const faces = [
      [0, 1, 3, 2], // x=-
      [4, 6, 7, 5], // x=+
      [0, 2, 6, 4], // y=-
      [1, 5, 7, 3], // y=+
      [0, 4, 5, 1], // z=-
      [2, 3, 7, 6], // z=+
    ];
    const tris = [];
    for (const [a, b, cc, d] of faces) {
      tris.push([c[a], c[b], c[cc]]);
      tris.push([c[a], c[cc], c[d]]);
    }
    return tris;
  }

  // 把局部坐标点（单位立方体 [-1,1]^3 内）变换到世界坐标
  localToWorld(local) {
    let p = this.center.slice();
    for (let k = 0; k < 3; k++) {
      p = add(p, scale(this.axes[k], local[k] * this.halfExtents[k]));
    }
    return p;
  }
}

// 沿某轴的投影区间 [min,max]
export function projectOBB(obb, axis) {
  const r =
    obb.halfExtents[0] * Math.abs(dot(axis, obb.axes[0])) +
    obb.halfExtents[1] * Math.abs(dot(axis, obb.axes[1])) +
    obb.halfExtents[2] * Math.abs(dot(axis, obb.axes[2]));
  const c = dot(obb.center, axis);
  return [c - r, c + r];
}

export function projectPoints(points, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const v = dot(p, axis);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

// OBB 角点投影到屏幕（像素），返回包围矩形；相机后方点在投影前剔除
export function screenBounds(obb, viewProj, width, height) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  for (const corner of obb.corners()) {
    const cp = transformPoint(viewProj, corner);
    // 剔除相机后方（NDC z 超出 [-1,1] 且点在近平面之后）的角点，避免透视除法发散
    if (!Number.isFinite(cp[0]) || cp[2] > 1) continue;
    const sx = (cp[0] * 0.5 + 0.5) * width;
    const sy = (1 - (cp[1] * 0.5 + 0.5)) * height;
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    any = true;
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

