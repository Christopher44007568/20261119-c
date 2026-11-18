/*
 * raster.js — 极简软件光栅化器
 *
 * 输入已经是“裁剪完成 + 透视除法之后”的屏幕空间顶点。
 * 属性插值默认透视正确：先在屏幕空间对 (a/w, 1/w) 线性插值，再乘回 w。
 * 可切换为朴素线性插值，直观对比错误做法的差异。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Raster = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function edge(p, a, b) {
    return (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
  }

  // verts: [{sx, sy, w, r, g, b, u, v}], 顺时针/逆时针均可（用有符号面积统一）
  function drawPolygon(ctx, verts, width, height, opts) {
    opts = opts || {};
    if (verts.length < 3) return;

    var area2 = 0;
    for (var i = 0; i < verts.length; i++) {
      var p0 = verts[i], p1 = verts[(i + 1) % verts.length];
      area2 += p0.sx * p1.sy - p1.sx * p0.sy;
    }
    var winding = area2 >= 0 ? 1 : -1;
    if (Math.abs(area2) < 1e-9) return; // 退化多边形，无可填充面积

    var img = ctx.createImageData(width, height);
    var data = img.data;
    var minY = height, maxY = 0, minX = width, maxX = 0;
    verts.forEach(function (v) {
      minY = Math.min(minY, Math.floor(v.sy)); maxY = Math.max(maxY, Math.ceil(v.sy));
      minX = Math.min(minX, Math.floor(v.sx)); maxX = Math.max(maxX, Math.ceil(v.sx));
    });
    minY = Math.max(0, minY); maxY = Math.min(height - 1, maxY);
    minX = Math.max(0, minX); maxX = Math.min(width - 1, maxX);
    if (minX > maxX || minY > maxY) return; // 完全落在画布之外

    var correct = opts.perspectiveCorrect !== false;
    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        var pt = { x: x + 0.5, y: y + 0.5 };
        var inside = true;
        for (var e = 0; e < verts.length; e++) {
          if (edge(pt, verts[e], verts[(e + 1) % verts.length]) * winding < 0) {
            inside = false;
            break;
          }
        }
        if (!inside) continue;

        // 以第一个顶点为锚的重心权重（对凸多边形足够）
        var weights = [];
        for (var k = 1; k < verts.length - 1; k++) {
          var a = verts[0], b = verts[k], c = verts[k + 1];
          var areaTri = (b.sx - a.sx) * (c.sy - a.sy) - (b.sy - a.sy) * (c.sy - a.sy);
          if (Math.abs(areaTri) < 1e-12) continue;
          var wa = ((b.sx - pt.x) * (c.sy - pt.y) - (b.sy - pt.y) * (c.sx - pt.x)) / areaTri;
          var wb = ((c.sx - pt.x) * (a.sy - pt.y) - (c.sy - pt.y) * (a.sx - pt.x)) / areaTri;
          var wc = 1 - wa - wb;
          if (wa >= -1e-6 && wb >= -1e-6 && wc >= -1e-6) {
            weights = [[0, wa], [k, wb], [k + 1, wc]];
            break;
          }
        }
        if (!weights.length) continue;

        var r = 0, g = 0, bl = 0, u = 0, v = 0;
        if (correct) {
          var invW = 0;
          weights.forEach(function (pair) {
            var vtx = verts[pair[0]], weight = pair[1];
            invW += weight / vtx.w;
            r += weight * vtx.r / vtx.w;
            g += weight * vtx.g / vtx.w;
            bl += weight * vtx.b / vtx.w;
            u += weight * vtx.u / vtx.w;
            v += weight * vtx.v / vtx.w;
          });
          var wHere = 1 / invW;
          r = clamp255(r * wHere); g = clamp255(g * wHere); bl = clamp255(bl * wHere);
          u = u * wHere; v = v * wHere;
        } else {
          weights.forEach(function (pair) {
            var vtx = verts[pair[0]], weight = pair[1];
            r += weight * vtx.r; g += weight * vtx.g; bl += weight * vtx.b;
            u += weight * vtx.u; v += weight * vtx.v;
          });
          r = clamp255(r); g = clamp255(g); bl = clamp255(bl);
        }

        var idx = (y * width + x) * 4;
        data[idx] = r; data[idx + 1] = g; data[idx + 2] = bl; data[idx + 3] = 255;
        if (opts.checker) {
          var cu = Math.floor(u * 8), cv = Math.floor(v * 8);
          if ((cu + cv) % 2 === 0) {
            data[idx] = data[idx] * 0.35 | 0;
            data[idx + 1] = data[idx + 1] * 0.35 | 0;
            data[idx + 2] = data[idx + 2] * 0.35 | 0;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v | 0;
  }

  return { drawPolygon: drawPolygon, edge: edge };
});
