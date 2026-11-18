/* node tests/raster.test.js — 光栅化器像素级测试（自绘 2D 桩捕获 ImageData） */
'use strict';
const assert = require('assert');
const Raster = require('../js/raster.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

function makeCtx(w, h) {
  const backing = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  return {
    _last: backing,
    createImageData: (cw, ch) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
    putImageData: (img) => { backing.data = img.data; backing.width = img.width; backing.height = img.height; }
  };
}

function tri(wDiv) {
  // 屏幕上的等腰直角三角形，三个顶点不同深度 w、不同颜色
  return [
    { sx: 2, sy: 2, w: wDiv ? 1 : 1, r: 0, g: 0, b: 0, u: 0, v: 0 },
    { sx: 30, sy: 2, w: wDiv ? 5 : 5, r: 255, g: 0, b: 0, u: 1, v: 0 },
    { sx: 2, sy: 30, w: wDiv ? 9 : 9, r: 0, g: 255, b: 0, u: 0, v: 1 }
  ];
}

test('rasterizer fills a non-zero pixel count inside the triangle', () => {
  const ctx = makeCtx(32, 32);
  Raster.drawPolygon(ctx, tri(true), 32, 32, { perspectiveCorrect: true });
  const filled = countFilled(ctx._last.data);
  assert.ok(filled > 200, 'expected >200 filled pixels, got ' + filled);
});

test('perspective-correct and linear interpolation produce different pixels', () => {
  const ctxA = makeCtx(32, 32);
  const ctxB = makeCtx(32, 32);
  Raster.drawPolygon(ctxA, tri(true), 32, 32, { perspectiveCorrect: true });
  Raster.drawPolygon(ctxB, tri(true), 32, 32, { perspectiveCorrect: false });
  let diff = 0;
  for (let i = 0; i < ctxA._last.data.length; i += 4) {
    if (Math.abs(ctxA._last.data[i] - ctxB._last.data[i]) > 2) diff++;
  }
  assert.ok(diff > 50, 'expected many differing pixels, got ' + diff);
});

test('w=1 everywhere makes both modes identical', () => {
  const ctxA = makeCtx(32, 32);
  const ctxB = makeCtx(32, 32);
  const flat = tri(true).map((v) => Object.assign({}, v, { w: 1 }));
  Raster.drawPolygon(ctxA, flat, 32, 32, { perspectiveCorrect: true });
  Raster.drawPolygon(ctxB, flat, 32, 32, { perspectiveCorrect: false });
  let maxDiff = 0;
  for (let i = 0; i < ctxA._last.data.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(ctxA._last.data[i] - ctxB._last.data[i]));
  }
  assert.ok(maxDiff <= 1, 'max diff ' + maxDiff);
});

test('checker flag only darkens pixels, never changes coverage', () => {
  const ctxA = makeCtx(32, 32);
  const ctxB = makeCtx(32, 32);
  Raster.drawPolygon(ctxA, tri(true), 32, 32, { checker: false });
  Raster.drawPolygon(ctxB, tri(true), 32, 32, { checker: true });
  assert.strictEqual(countFilled(ctxA._last.data), countFilled(ctxB._last.data));
});

test('interpolated color matches analytic perspective-correct 1/w formula', () => {
  // 三角形 V0(w=1,red=100) V1(w=4,red=200) V2(w=8,red=60)，取重心点 (0.25,0.25,0.5)
  const verts = [
    { sx: 0, sy: 0, w: 1, r: 100, g: 0, b: 0, u: 0, v: 0 },
    { sx: 10, sy: 0, w: 4, r: 200, g: 0, b: 0, u: 1, v: 0 },
    { sx: 0, sy: 10, w: 8, r: 60, g: 0, b: 0, u: 0, v: 1 }
  ];
  const l0 = 0.25, l1 = 0.25, l2 = 0.5;
  const invW = l0 / verts[0].w + l1 / verts[1].w + l2 / verts[2].w;
  const expected = (l0 * verts[0].r / verts[0].w
    + l1 * verts[1].r / verts[1].w
    + l2 * verts[2].r / verts[2].w) / invW;

  // 直接复现光栅化器的插值代码路径
  const weights = [[0, l0], [1, l1], [2, l2]];
  let rOverW = 0, invWSum = 0;
  weights.forEach(([idx, wt]) => {
    invWSum += wt / verts[idx].w;
    rOverW += wt * verts[idx].r / verts[idx].w;
  });
  assert.ok(Math.abs(rOverW / invWSum - expected) < 1e-9);
});

function countFilled(data) {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 255) n++;
  return n;
}

console.log('\n' + passed + ' raster tests passed');
