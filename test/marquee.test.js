import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDrag, rectToNDC } from '../src/marquee.js';

const vp = { width: 1000, height: 800 };

test('正向拖框', () => {
  const d = normalizeDrag({ x: 100, y: 100 }, { x: 300, y: 400 }, vp);
  assert.equal(d.reversed, false);
  assert.deepEqual(d.rect, { minX: 100, minY: 100, maxX: 300, maxY: 400 });
  assert.equal(d.clamped, false);
});

test('反向拖框（向左向上）归一化后矩形一致，且标记 reversed', () => {
  const d = normalizeDrag({ x: 300, y: 400 }, { x: 100, y: 100 }, vp);
  assert.equal(d.reversed, true);
  assert.deepEqual(d.rect, { minX: 100, minY: 100, maxX: 300, maxY: 400 });
  assert.match(d.direction, /反向/);
});

test('视口外拖动被夹取到视口边界并标记 clamped', () => {
  const d = normalizeDrag({ x: -50, y: -40 }, { x: 1200, y: 900 }, vp);
  assert.equal(d.clamped, true);
  assert.deepEqual(d.rect, { minX: 0, minY: 0, maxX: 1000, maxY: 800 });
});

test('零面积矩形判定为退化', () => {
  const d = normalizeDrag({ x: 100, y: 100 }, { x: 100, y: 250 }, vp);
  assert.equal(d.degenerate, true);
});

test('像素矩形转 NDC 时 y 轴翻转', () => {
  const n = rectToNDC({ minX: 0, minY: 0, maxX: 1000, maxY: 800 }, vp);
  assert.equal(n.xmin, -1);
  assert.equal(n.xmax, 1);
  assert.equal(n.ymin, -1);
  assert.equal(n.ymax, 1);
  const half = rectToNDC({ minX: 0, minY: 0, maxX: 500, maxY: 400 }, vp);
  assert.equal(half.xmax, 0);
  assert.equal(half.ymin, 0);
});
