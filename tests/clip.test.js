/* node tests/clip.test.js — 裁剪与投影纯数学单元测试 */
'use strict';
const assert = require('assert');
const Clip = require('../js/clip.js');
const Mat = require('../js/mat.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

function v(x, y, z, w, attr) {
  attr = attr || {};
  return {
    x, y, z, w,
    r: attr.r != null ? attr.r : 200,
    g: attr.g != null ? attr.g : 100,
    b: attr.b != null ? attr.b : 50,
    u: attr.u != null ? attr.u : 0,
    v: attr.v != null ? attr.v : 0
  };
}

// 1. 完全在视锥内：顶点数不变
test('inside triangle passes through unchanged', () => {
  const tri = [v(0, 0, 0, 1), v(0.5, 0, 0, 1), v(0, 0.5, 0, 1)];
  const res = Clip.clipPolygon(tri);
  assert.strictEqual(res.rejected, false);
  assert.strictEqual(res.outputCount, 3);
});

// 2. 单顶点穿过近平面：输出四边形，交点在 w+z=0 上
test('near plane clip yields quad and intersection lies on plane', () => {
  const tri = [v(0, 0, -2, 1), v(-0.5, 0.5, 0, 1), v(0.5, 0.5, 0, 1)];
  const near = Clip.PLANES[0];
  const res = Clip.clipPolygon(tri);
  assert.strictEqual(res.outputCount, 4);
  res.vertices.forEach((p) => assert.ok(Clip.distance(near, p) >= -1e-9));
  const hit = res.vertices.find((p) => p.onPlane === 'near');
  assert.ok(hit);
  assert.ok(Math.abs(hit.w + hit.z) < 1e-9);
});

// 3. 跨多个平面：所有输出顶点对六个平面均在内侧
test('multi-plane clip keeps every output vertex inside all planes', () => {
  const tri = [v(3, 3, 3, 1), v(-3, -2, 0, 1), v(2, -3, -3, 1)];
  const res = Clip.clipPolygon(tri);
  assert.ok(res.outputCount >= 3);
  res.vertices.forEach((p) => {
    Clip.PLANES.forEach((pl) => assert.ok(Clip.distance(pl, p) >= -1e-9, pl.name));
  });
  const touched = res.perPlane.filter((s) => s.intersections > 0).length;
  assert.ok(touched >= 2, 'should intersect at least two planes');
});

// 4. 整个三角形在相机后面（w<0）：被整体拒绝
test('triangle fully behind camera is rejected', () => {
  const tri = [v(0, 0, 2, -1), v(1, 0, 2, -1), v(0, 1, 2, -1)];
  const res = Clip.clipPolygon(tri);
  assert.strictEqual(res.rejected, true);
  assert.strictEqual(res.outputCount, 0);
});

// 5. 整个三角形在近平面前面（z<-w）：被整体拒绝
test('triangle fully in front of near plane is rejected', () => {
  const tri = [v(0, 0, -5, 1), v(0.4, 0, -5, 1), v(0, 0.4, -5, 1)];
  const res = Clip.clipPolygon(tri);
  assert.strictEqual(res.rejected, true);
});

// 6. w 接近 0：裁剪本身不做除法，仍可正确处理
test('near-zero w vertex is handled without dividing before clip', () => {
  const eps = 1e-7;
  const tri = [v(0, 0, 0, eps), v(-0.5, 0.5, 0.2, 1), v(0.5, 0.5, 0.2, 1)];
  const res = Clip.clipPolygon(tri);
  assert.ok(res.outputCount >= 3);
  const ndc = Clip.perspectiveDivide(tri[0], 1e-6);
  assert.strictEqual(ndc.valid, false);
  const ndcSafe = Clip.perspectiveDivide(tri[1], 1e-6);
  assert.strictEqual(ndcSafe.valid, true);
});

// 7. 属性沿裁剪边线性插值，且 t 与 w 插值一致
test('attributes are interpolated linearly along the clip edge', () => {
  const a = v(0, 0, -2, 1, { r: 0, g: 0, b: 0, u: 0, v: 0 });
  const b = v(0, 0, 2, 1, { r: 255, g: 255, b: 255, u: 1, v: 1 });
  const hit = Clip.intersectVertex(Clip.PLANES[0], a, b);
  assert.ok(Math.abs(hit.t - 0.25) < 1e-9);
  assert.ok(Math.abs(hit.r - 63.75) < 1e-6);
  assert.ok(Math.abs(hit.u - 0.25) < 1e-9);
  assert.ok(Math.abs(hit.w - 1) < 1e-9);
});

// 8. 投影往返：eye -> clip -> inverse -> eye
test('projection round trip eye->clip->eye recovers coordinates', () => {
  const P = Mat.perspective(Math.PI / 3, 16 / 9, 1, 50);
  const inv = Mat.invert4(P);
  const e = { x: 0.7, y: -0.3, z: -8, w: 1 };
  const c = Mat.transform(P, e);
  const back = Mat.transform(inv, c);
  ['x', 'y', 'z', 'w'].forEach((k) => assert.ok(Math.abs(back[k] - e[k]) < 1e-9));
  assert.ok(Math.abs(c.w - 8) < 1e-9, 'clip w equals -eye z');
});

// 9. 视锥内眼睛空间点投影后满足全部六个齐次不等式
test('frustum-contained eye point satisfies all six clip inequalities', () => {
  const P = Mat.perspective(Math.PI / 3, 1, 2, 20);
  const clip = Mat.eyeToClip(P, { x: 0.5, y: 0.5, z: -5, w: 1,
    r: 1, g: 1, b: 1, u: 0, v: 0 });
  Clip.PLANES.forEach((pl) => assert.ok(Clip.distance(pl, clip) >= 0, pl.name));
});

// 10. 裁剪后 NDC 面积不大于原三角形 NDC 面积
test('clipped ndc area never exceeds original ndc area', () => {
  const tri = [v(0, 0, -2, 1), v(-2, 1.5, 0, 1), v(2, 1.5, 0, 1)];
  const before = Clip.ndcArea(tri);
  const res = Clip.clipPolygon(tri);
  const after = Clip.ndcArea(res.vertices);
  assert.ok(after <= before + 1e-9);
  assert.ok(after > 0);
});

console.log('\n' + passed + ' tests passed');
