/*
 * mat.js — 投影矩阵与几何工具
 *
 * 眼睛空间采用 OpenGL 约定：相机位于原点，看向 -z，近/远平面 z 均为负值。
 * 透视投影输出裁剪空间坐标 c = P * e，其中 c.w = -e.z。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mat = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // OpenGL 透视投影矩阵（列主序，与 glFrustum 一致）
  function perspective(fovyRad, aspect, near, far) {
    var f = 1 / Math.tan(fovyRad / 2);
    var nf = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ];
  }

  // 列主序 4x4 矩阵乘向量
  function transform(m, e) {
    return {
      x: m[0] * e.x + m[4] * e.y + m[8]  * e.z + m[12] * e.w,
      y: m[1] * e.x + m[5] * e.y + m[9]  * e.z + m[13] * e.w,
      z: m[2] * e.x + m[6] * e.y + m[10] * e.z + m[14] * e.w,
      w: m[3] * e.x + m[7] * e.y + m[11] * e.z + m[15] * e.w
    };
  }

  // 眼睛空间顶点（含属性）-> 裁剪空间顶点；此处不做任何除法
  function eyeToClip(m, e) {
    var c = transform(m, { x: e.x, y: e.y, z: e.z, w: 1 });
    return {
      x: c.x, y: c.y, z: c.z, w: c.w,
      r: e.r, g: e.g, b: e.b, u: e.u, v: e.v
    };
  }

  // Gauss-Jordan 列主序 4x4 求逆；奇异时返回 null
  function invert4(m) {
    var a = [];
    for (var col = 0; col < 4; col++) {
      for (var row = 0; row < 4; row++) a[row * 4 + col] = m[col * 4 + row];
    }
    var aug = new Array(16).fill(0);
    for (var i = 0; i < 4; i++) {
      aug[i * 4 + i] = 1;
    }
    for (var piv = 0; piv < 4; piv++) {
      var maxRow = piv;
      for (var r = piv + 1; r < 4; r++) {
        if (Math.abs(a[r * 4 + piv]) > Math.abs(a[maxRow * 4 + piv])) maxRow = r;
      }
      if (Math.abs(a[maxRow * 4 + piv]) < 1e-12) return null;
      for (var k = 0; k < 4; k++) {
        var tmp = a[piv * 4 + k];
        a[piv * 4 + k] = a[maxRow * 4 + k];
        a[maxRow * 4 + k] = tmp;
        tmp = aug[piv * 4 + k];
        aug[piv * 4 + k] = aug[maxRow * 4 + k];
        aug[maxRow * 4 + k] = tmp;
      }
      var d = a[piv * 4 + piv];
      for (var k2 = 0; k2 < 4; k2++) {
        a[piv * 4 + k2] /= d;
        aug[piv * 4 + k2] /= d;
      }
      for (var r2 = 0; r2 < 4; r2++) {
        if (r2 === piv) continue;
        var factor = a[r2 * 4 + piv];
        for (var k3 = 0; k3 < 4; k3++) {
          a[r2 * 4 + k3] -= factor * a[piv * 4 + k3];
          aug[r2 * 4 + k3] -= factor * aug[piv * 4 + k3];
        }
      }
    }
    var out = new Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r3 = 0; r3 < 4; r3++) out[c * 4 + r3] = aug[r3 * 4 + c];
    }
    return out;
  }

  // 裁剪空间顶点反投影回眼睛空间（用于在 3D 视图中画裁剪后的多边形）
  function clipToEye(invM, c) {
    var e = transform(invM, { x: c.x, y: c.y, z: c.z, w: c.w });
    return { x: e.x, y: e.y, z: e.z, r: c.r, g: c.g, b: c.b, u: c.u, v: c.v };
  }

  // NDC -> 屏幕像素
  function viewport(ndcX, ndcY, width, height) {
    return {
      x: (ndcX * 0.5 + 0.5) * width,
      y: (1 - (ndcY * 0.5 + 0.5)) * height
    };
  }

  // 眼睛空间多边形 3D 面积（叉积和，三角形时退化为普通三角形面积）
  function eyeArea(verts) {
    if (verts.length < 3) return 0;
    var ax = 0, ay = 0, az = 0;
    for (var i = 1; i < verts.length - 1; i++) {
      var p = verts[0], q = verts[i], r = verts[i + 1];
      var ux = q.x - p.x, uy = q.y - p.y, uz = q.z - p.z;
      var vx = r.x - p.x, vy = r.y - p.y, vz = r.z - p.z;
      ax += uy * vz - uz * vy;
      ay += uz * vx - ux * vz;
      az += ux * vy - uy * vx;
    }
    return 0.5 * Math.sqrt(ax * ax + ay * ay + az * az);
  }

  // 视锥八个角点（眼睛空间），用于 3D/俯视图绘制
  function frustumCorners(fovyRad, aspect, near, far) {
    var tan = Math.tan(fovyRad / 2);
    function cornersAt(z) {
      var h = -z * tan, w = h * aspect;
      return [
        { x: -w, y: -h, z: z }, { x: w, y: -h, z: z },
        { x: w, y: h, z: z },   { x: -w, y: h, z: z }
      ];
    }
    // 相机看向 -z：近/远平面位于 z=-near、z=-far（near/far 为正数距离）
    return cornersAt(-near).concat(cornersAt(-far));
  }

  return {
    perspective: perspective,
    transform: transform,
    eyeToClip: eyeToClip,
    invert4: invert4,
    clipToEye: clipToEye,
    viewport: viewport,
    eyeArea: eyeArea,
    frustumCorners: frustumCorners
  };
});
