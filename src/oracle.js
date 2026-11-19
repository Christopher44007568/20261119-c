// 独立几何判定器（oracle）：刻意采用与 selection.js 的 SAT 完全不同的算法，
// 用于交叉验证体积选择结果，防止两套代码共享同一错误假设。
//
// 相交判定（凸多面体 A=选择体, B=OBB）：
//   1. 用 A 的 6 个内侧半空间裁剪 B 的单位立方体（仿射映射后），
//      只要裁剪后仍有体积 -> 相交；
//   2. 兜底：A 的任一角点在 B 内，或 B 的任一角点在 A 内（处理 A 完全处于 B 内等情形）；
//   3. 兜底：B 的 12 条边与 B 自身三角面、A 的 12 条边与 B 的三角面做 Moller-Trumbore 求交。
// 完全包含：B 的 8 个角点全部通过 A 的 6 个半空间测试。

import { dot, sub } from './math.js';

function signed(plane, p) {
  return dot(plane.normal, p) + plane.d;
}

// Sutherland-Hodgman 半空间裁剪多边形
function clipPolygon(polygon, plane, eps) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const cur = polygon[i];
    const prev = polygon[(i + polygon.length - 1) % polygon.length];
    const dCur = signed(plane, cur);
    const dPrev = signed(plane, prev);
    const inCur = dCur >= -eps;
    const inPrev = dPrev >= -eps;
    if (inCur) {
      if (!inPrev) out.push(intersectEdge(prev, cur, dPrev, dCur));
      out.push(cur);
    } else if (inPrev) {
      out.push(intersectEdge(prev, cur, dPrev, dCur));
    }
  }
  return out;
}

function intersectEdge(a, b, da, db) {
  const t = da / (da - db);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function polygonArea3(poly) {
  if (poly.length < 3) return 0;
  let area2 = 0;
  for (let i = 1; i < poly.length - 1; i++) {
    const u = sub(poly[i], poly[0]);
    const v = sub(poly[i + 1], poly[0]);
    area2 += Math.hypot(
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    );
  }
  return area2 / 2;
}

// Moller-Trumbore 线段/三角形求交
function segmentTriangle(p0, p1, tri, eps) {
  const [a, b, c] = tri;
  const edge1 = sub(b, a);
  const edge2 = sub(c, a);
  const dir = sub(p1, p0);
  const h = [
    dir[1] * edge2[2] - dir[2] * edge2[1],
    dir[2] * edge2[0] - dir[0] * edge2[2],
    dir[0] * edge2[1] - dir[1] * edge2[0],
  ];
  const det = dot(edge1, h);
  if (Math.abs(det) < eps) return false;
  const inv = 1 / det;
  const s = sub(p0, a);
  const u = dot(s, h) * inv;
  if (u < -eps || u > 1 + eps) return false;
  const q = [
    s[1] * edge1[2] - s[2] * edge1[1],
    s[2] * edge1[0] - s[0] * edge1[2],
    s[0] * edge1[1] - s[1] * edge1[0],
  ];
  const v = dot(dir, q) * inv;
  if (v < -eps || u + v > 1 + eps) return false;
  const t = dot(edge2, q) * inv;
  return t >= -eps && t <= 1 + eps;
}

function segmentHitsAnyTri(p0, p1, tris, eps) {
  return tris.some((tri) => segmentTriangle(p0, p1, tri, eps));
}

export function oracleContained(frustum, obb, eps = 1e-7) {
  return obb.corners().every((p) => frustum.planes.every((pl) => signed(pl, p) >= -eps));
}

export function oracleIntersects(frustum, obb, eps = 1e-7) {
  // 路径 1：用选择体半空间裁剪 OBB 的 6 个面，任一面裁剪后仍有面积
  const obbTris = obb.triangles();
  const faces = [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
  ];
  const allCorners = obb.corners();
  for (const face of faces) {
    let poly = face.map((idx) => allCorners[idx]);
    for (const plane of frustum.planes) {
      poly = clipPolygon(poly, plane, eps);
      if (poly.length < 3) break;
    }
    if (polygonArea3(poly) > 1e-10) return true;
  }

  // 路径 2：互含点（一个多面体完全在另一个内部的情况）
  if (frustum.corners().some((p) => obb.containsPoint(p, eps))) return true;
  if (obb.corners().some((p) => frustum.containsPoint(p, eps))) return true;

  // 路径 3：边-三角形求交
  const frustumEdges = frustum.constructor.EDGES;
  const fCorners = frustum.corners();
  for (const [i, j] of frustumEdges) {
    if (segmentHitsAnyTri(fCorners[i], fCorners[j], obbTris, eps)) return true;
  }
  const fTris = [];
  for (const face of frustum.constructor.FACES) {
    fTris.push([fCorners[face[0]], fCorners[face[1]], fCorners[face[2]]]);
    fTris.push([fCorners[face[0]], fCorners[face[2]], fCorners[face[3]]]);
  }
  const obbEdges = obb.constructor.EDGES;
  for (const [i, j] of obbEdges) {
    if (segmentHitsAnyTri(allCorners[i], allCorners[j], fTris, eps)) return true;
  }
  return false;
}

export function oracleClassify(frustum, obb, eps = 1e-7) {
  if (oracleContained(frustum, obb, eps)) return 'contained';
  return oracleIntersects(frustum, obb, eps) ? 'intersects' : 'outside';
}
