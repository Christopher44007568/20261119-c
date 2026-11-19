import test from 'node:test';
import assert from 'node:assert/strict';
import {
  invert, lookAt, multiply, ortho, perspective, transformPoint, ndcScaleBias,
} from '../src/math.js';

test('invert 与原矩阵相乘为单位矩阵', () => {
  const m = lookAt([3, 4, 5], [0, 0, 0], [0, 1, 0]);
  const inv = invert(m);
  const prod = multiply(m, inv);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const expect = r === c ? 1 : 0;
      assert.ok(Math.abs(prod[r * 4 + c] - expect) < 1e-9);
    }
  }
});

test('透视投影后视锥八个角点落在 NDC 立方体顶点', () => {
  const eye = [0, 0, 10];
  const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  const proj = perspective(Math.PI / 4, 16 / 9, 0.5, 50);
  const vp = multiply(proj, view);
  // 相机空间角点：近平面 z=-0.5，远平面 z=-50
  const tanHalf = Math.tan(Math.PI / 8);
  const aspect = 16 / 9;
  const corners = [];
  for (const z of [-0.5, -50]) {
    const h = -z * tanHalf;
    const w = h * aspect;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        corners.push([eye[0] + sx * w, eye[1] + sy * h, eye[2] + z]);
      }
    }
  }
  for (const p of corners) {
    const ndc = transformPoint(vp, p);
    ndc.forEach((v) => assert.ok(Math.abs(Math.abs(v) - 1) < 1e-8));
  }
});

test('正交投影为线性映射（w=1），角点同样映射到 NDC 顶点', () => {
  const view = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const proj = ortho(-4, 4, -3, 3, 0.5, 20);
  const vp = multiply(proj, view);
  const ndc = transformPoint(vp, [4, 3, 5 - 0.5]);
  assert.ok(Math.abs(ndc[0] - 1) < 1e-9);
  assert.ok(Math.abs(ndc[1] - 1) < 1e-9);
  assert.ok(Math.abs(ndc[2] + 1) < 1e-9);
});

test('ndcScaleBias 把 NDC 立方体映射到屏幕子盒', () => {
  const b = ndcScaleBias(-0.5, 0.5, -0.25, 0.75);
  const p = transformPoint(b, [-1, -1, 0]);
  assert.deepEqual(p.map((v) => +v.toFixed(6)), [-0.5, -0.25, 0]);
  const q = transformPoint(b, [1, 1, 0]);
  assert.deepEqual(q.map((v) => +v.toFixed(6)), [0.5, 0.75, 0]);
});
