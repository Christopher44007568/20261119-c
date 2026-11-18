/*
 * views.js — 三个画布视图的纯绘制逻辑
 *   view3D : 眼睛空间 3D 透视视图（视锥、原三角形、裁剪后多边形）
 *   topView: x-z 俯视图，可直接拖拽顶点穿过近平面
 *   screen : 裁剪 + 透视除法后的最终屏幕图像（软件光栅化）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mat.js'), require('./clip.js'), require('./raster.js'));
  else root.Views = factory(root.Mat, root.Clip, root.Raster);
})(typeof self !== 'undefined' ? self : globalThis, function (Mat, Clip, Raster) {
  'use strict';

  function clear(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);
  }

  function label(ctx, text, x, y, color) {
    ctx.font = '11px monospace';
    ctx.fillStyle = color || '#c9d1d9';
    ctx.fillText(text, x + 6, y - 6);
  }

  // ---------- 3D 透视视图 ----------
  function makeCamera3D() {
    return { yaw: 0.9, pitch: 0.35, dist: 26 };
  }

  function project3D(p, cam, w, h) {
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    // 绕 Y 再绕 X 旋转，然后沿 -z 平移
    var x1 = cy * p.x - sy * p.z;
    var z1 = sy * p.x + cy * p.z;
    var y1 = cp * p.y - sp * z1;
    var z2 = sp * p.y + cp * z1 + cam.dist;
    if (z2 <= 0.1) return null;
    var f = h * 0.9;
    return { x: w / 2 + f * x1 / z2, y: h / 2 - f * y1 / z2, depth: z2 };
  }

  function drawLine3D(ctx, a, b, cam, w, h, color, width) {
    var pa = project3D(a, cam, w, h), pb = project3D(b, cam, w, h);
    if (!pa || !pb) return;
    ctx.strokeStyle = color; ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }

  function drawView3D(ctx, w, h, cam, frustum, eyeVerts, clippedEye, selected) {
    clear(ctx, w, h);
    var corners = Mat.frustumCorners(frustum.fovyDeg * Math.PI / 180, frustum.aspect, frustum.near, frustum.far);
    // 视锥线框
    for (var i = 0; i < 4; i++) {
      drawLine3D(ctx, corners[i], corners[(i + 1) % 4], cam, w, h, '#3d4f5f', 1);
      drawLine3D(ctx, corners[4 + i], corners[4 + ((i + 1) % 4)], cam, w, h, '#3d4f5f', 1);
      drawLine3D(ctx, corners[i], corners[4 + i], cam, w, h, '#54708a', 1);
    }
    var origin = { x: 0, y: 0, z: 0 };
    drawLine3D(ctx, origin, { x: 2, y: 0, z: 0 }, cam, w, h, '#ff6b6b', 1.5);
    drawLine3D(ctx, origin, { x: 0, y: 2, z: 0 }, cam, w, h, '#69db7c', 1.5);
    drawLine3D(ctx, origin, { x: 0, y: 0, z: -2 }, cam, w, h, '#74c0fc', 1.5);

    // 原始三角形（虚线表示未经裁剪的几何）
    ctx.setLineDash([5, 4]);
    for (var t = 0; t < eyeVerts.length; t++) {
      drawLine3D(ctx, eyeVerts[t], eyeVerts[(t + 1) % eyeVerts.length], cam, w, h, '#8b949e', 1.2);
    }
    ctx.setLineDash([]);

    // 裁剪后多边形（反投影回眼睛空间），实心半透明
    if (clippedEye && clippedEye.length >= 3) {
      var pts = clippedEye.map(function (p) { return project3D(p, cam, w, h); });
      if (pts.every(Boolean)) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(110, 180, 255, 0.28)';
        ctx.fill();
        ctx.strokeStyle = '#74c0fc'; ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // 顶点与交点
    eyeVerts.forEach(function (v, idx) {
      var pp = project3D(v, cam, w, h);
      if (!pp) return;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, idx === selected ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = idx === selected ? '#ffd43b' : rgb(v);
      ctx.fill();
      label(ctx, 'V' + idx, pp.x, pp.y, idx === selected ? '#ffd43b' : '#e6edf3');
    });
    if (clippedEye) {
      clippedEye.forEach(function (v, idx) {
        if (v.generated) {
          var pp2 = project3D(v, cam, w, h);
          if (!pp2) return;
          ctx.beginPath();
          ctx.arc(pp2.x, pp2.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffd43b';
          ctx.fill();
          label(ctx, 'I' + idx, pp2.x, pp2.y, '#ffd43b');
        }
      });
    }
    label(ctx, '眼睛空间（红X 绿Y 蓝Z，看向 -Z）', 10, 16, '#8b949e');
  }

  function rgb(v) { return 'rgb(' + (v.r | 0) + ',' + (v.g | 0) + ',' + (v.b | 0) + ')'; }

  // ---------- x-z 俯视图 ----------
  function topTransform(frustum, w, h) {
    // z 轴：场景深处为负（z=-far），相机后方留到 +3 以显示越机顶点
    var zMin = -frustum.far - 1, zMax = 3;
    var xSpan = Math.abs(frustum.far) * Math.tan(frustum.fovyDeg * Math.PI / 360) * frustum.aspect + 3;
    var scale = Math.min((w - 40) / (2 * xSpan), (h - 40) / (zMin - zMax));
    return {
      scale: scale,
      toScreen: function (x, z) {
        return { x: w / 2 + x * scale, y: 20 + (z - zMax) * scale };
      },
      toWorld: function (sx, sy) {
        return { x: (sx - w / 2) / scale, z: (sy - 20) / scale + zMax };
      }
    };
  }

  function drawTopView(ctx, w, h, frustum, eyeVerts, selected) {
    clear(ctx, w, h);
    var tr = topTransform(frustum, w, h);
    var corners = Mat.frustumCorners(frustum.fovyDeg * Math.PI / 180, frustum.aspect, frustum.near, frustum.far);
    var nearL = tr.toScreen(corners[0].x, corners[0].z);
    var nearR = tr.toScreen(corners[1].x, corners[1].z);
    var farL = tr.toScreen(corners[4].x, corners[4].z);
    var farR = tr.toScreen(corners[5].x, corners[5].z);

    ctx.strokeStyle = '#54708a'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(nearL.x, nearL.y); ctx.lineTo(farL.x, farL.y);
    ctx.moveTo(nearR.x, nearR.y); ctx.lineTo(farR.x, farR.y);
    ctx.stroke();
    ctx.strokeStyle = '#e8590c'; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(nearL.x, nearL.y); ctx.lineTo(nearR.x, nearR.y); ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, '近平面 z=-' + frustum.near, nearL.x, nearL.y, '#ff922b');

    var cam = tr.toScreen(0, 0);
    ctx.fillStyle = '#e6edf3';
    ctx.beginPath(); ctx.arc(cam.x, cam.y, 4, 0, Math.PI * 2); ctx.fill();
    label(ctx, '相机', cam.x, cam.y, '#e6edf3');

    ctx.strokeStyle = '#8b949e'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    eyeVerts.forEach(function (v, i) {
      var p = tr.toScreen(v.x, v.z);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath(); ctx.stroke();

    eyeVerts.forEach(function (v, i) {
      var p = tr.toScreen(v.x, v.z);
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === selected ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = i === selected ? '#ffd43b' : rgb(v);
      ctx.fill();
      label(ctx, 'V' + i + ' (' + v.x.toFixed(2) + ',' + v.z.toFixed(2) + ')', p.x, p.y);
    });
    label(ctx, '俯视图 X-Z：拖拽顶点即可穿过近平面', 10, h - 10, '#8b949e');
    return tr;
  }

  // ---------- 屏幕图像 ----------
  function drawScreen(ctx, w, h, clipVerts, rejected, opts) {
    clear(ctx, w, h);
    // NDC 边界框
    ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    if (rejected || clipVerts.length < 3) {
      ctx.fillStyle = '#f03e3e';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('三角形被裁剪器整体拒绝', w / 2, h / 2);
      ctx.textAlign = 'left';
      return [];
    }

    var screenVerts = clipVerts.map(function (c) {
      var ndc = Clip.perspectiveDivide(c, 1e-6);
      var sp = Mat.viewport(ndc.x, ndc.y, w, h);
      return {
        sx: sp.x, sy: sp.y, w: Math.abs(c.w) < 1e-6 ? 1e-6 : c.w,
        r: c.r, g: c.g, b: c.b, u: c.u, v: c.v,
        invalid: !ndc.valid, clip: c
      };
    });

    Raster.drawPolygon(ctx, screenVerts, w, h, {
      perspectiveCorrect: opts.perspectiveCorrect,
      checker: opts.checker
    });

    // 线框与顶点
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    screenVerts.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
    });
    ctx.closePath(); ctx.stroke();
    screenVerts.forEach(function (p, i) {
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, p.clip.generated ? 4 : 5, 0, Math.PI * 2);
      ctx.fillStyle = p.invalid ? '#f03e3e' : (p.clip.generated ? '#ffd43b' : rgb(p));
      ctx.fill();
    });
    label(ctx, '屏幕图像（裁剪后才透视除法）', 10, 16, '#8b949e');
    return screenVerts;
  }

  return {
    makeCamera3D: makeCamera3D,
    project3D: project3D,
    drawView3D: drawView3D,
    topTransform: topTransform,
    drawTopView: drawTopView,
    drawScreen: drawScreen,
    rgb: rgb
  };
});
