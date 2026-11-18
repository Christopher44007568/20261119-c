/*
 * clip.js — 齐次裁剪核心（透视除法之前执行）
 *
 * 约定：所有输入顶点处于裁剪空间 (clip space)，分量为 (x, y, z, w)。
 * 六个视锥平面在齐次坐标下表达为线性不等式：
 *
 *   -w <= x <= w
 *   -w <= y <= w
 *   -w <= z <= w
 *
 * 因此任意平面都可写成 d(v) = a*x + b*y + c*z + d*w >= 0，
 * 整条裁剪流水线中不需要、也不允许先做透视除法 (x/w, y/w, z/w)。
 *
 * 顶点携带的属性（颜色、UV 等）在裁剪空间沿裁剪边做线性插值；
 * 透视除法之后的属性插值天然是透视正确的（1/w 修正）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Clip = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // 六个平面，distance(v) >= 0 表示 v 在内侧
  var PLANES = [
    { name: 'near',  a: 0,  b: 0,  c:  1, d: 1 }, // w + z >= 0
    { name: 'far',   a: 0,  b: 0,  c: -1, d: 1 }, // w - z >= 0
    { name: 'left',  a: 1,  b: 0,  c:  0, d: 1 }, // w + x >= 0
    { name: 'right', a: -1, b: 0,  c:  0, d: 1 }, // w - x >= 0
    { name: 'bottom', a: 0, b: 1,  c:  0, d: 1 }, // w + y >= 0
    { name: 'top',  a: 0,  b: -1, c:  0, d: 1 }  // w - y >= 0
  ];

  function distance(plane, v) {
    return plane.a * v.x + plane.b * v.y + plane.c * v.z + plane.d * v.w;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  // 沿裁剪边 A->B 在 t 处生成新顶点。t 在齐次分量 (x,y,z,w) 上线性求解，
  // 同一 t 直接作用于全部属性——这正是“沿裁剪边插值属性”。
  function intersectVertex(plane, a, b) {
    var da = distance(plane, a);
    var db = distance(plane, b);
    var denom = da - db;
    var t = Math.abs(denom) < 1e-12 ? 0 : da / denom;
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      z: lerp(a.z, b.z, t),
      w: lerp(a.w, b.w, t),
      r: lerp(a.r, b.r, t),
      g: lerp(a.g, b.g, t),
      b: lerp(a.b, b.b, t),
      u: lerp(a.u, b.u, t),
      v: lerp(a.v, b.v, t),
      t: t,
      onPlane: plane.name
    };
  }

  // 对单个平面做 Sutherland-Hodgman，返回该平面内侧的输出多边形与统计
  function clipPlane(polygon, plane, stats) {
    var out = [];
    if (polygon.length === 0) return out;
    for (var i = 0; i < polygon.length; i++) {
      var cur = polygon[i];
      var prev = polygon[(i + polygon.length - 1) % polygon.length];
      var curIn = distance(plane, cur) >= 0;
      var prevIn = distance(plane, prev) >= 0;

      if (curIn) {
        if (!prevIn) {
          out.push(intersectVertex(plane, prev, cur));
          stats.intersections++;
        }
        out.push(cur);
      } else if (prevIn) {
        out.push(intersectVertex(plane, cur, prev));
        stats.intersections++;
      }
    }
    return out;
  }

  // 依次对六个平面裁剪；返回输出顶点、每平面统计、以及是否被整体拒绝
  function clipPolygon(input) {
    var polygon = input.slice();
    var perPlane = PLANES.map(function (p) {
      return { plane: p.name, inCount: polygon.length, outCount: 0, intersections: 0 };
    });
    var rejected = false;

    for (var i = 0; i < PLANES.length && polygon.length > 0; i++) {
      var stats = perPlane[i];
      polygon = clipPlane(polygon, PLANES[i], stats);
      stats.outCount = polygon.length;
    }
    if (polygon.length === 0) rejected = true;

    return {
      vertices: polygon,
      perPlane: perPlane,
      rejected: rejected,
      inputCount: input.length,
      outputCount: polygon.length
    };
  }

  // 透视除法：只在裁剪全部完成之后调用。
  // w 接近 0 时返回标记，渲染层据此做保护，而不是在裁剪前规避它。
  function perspectiveDivide(v, eps) {
    eps = eps == null ? 1e-6 : eps;
    var safe = Math.abs(v.w) >= eps;
    var inv = safe ? 1 / v.w : 0;
    return {
      x: v.x * inv,
      y: v.y * inv,
      z: v.z * inv,
      w: v.w,
      valid: safe && v.w > 0
    };
  }

  // NDC xy 平面内的多边形面积（裁剪后多边形投影到屏幕）
  function ndcArea(clipVerts) {
    if (clipVerts.length < 3) return 0;
    var sum = 0;
    for (var i = 0; i < clipVerts.length; i++) {
      var p = perspectiveDivide(clipVerts[i]);
      var q = perspectiveDivide(clipVerts[(i + 1) % clipVerts.length]);
      sum += p.x * q.y - q.x * p.y;
    }
    return Math.abs(sum) * 0.5;
  }

  return {
    PLANES: PLANES,
    distance: distance,
    intersectVertex: intersectVertex,
    clipPlane: clipPlane,
    clipPolygon: clipPolygon,
    perspectiveDivide: perspectiveDivide,
    ndcArea: ndcArea
  };
});
