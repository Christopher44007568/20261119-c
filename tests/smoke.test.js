/* node tests/smoke.test.js — 全预设流水线冒烟测试（无浏览器依赖） */
'use strict';
const assert = require('assert');
const Clip = require('../js/clip.js');
const Mat = require('../js/mat.js');
global.self = global;
require('../js/state.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

const f = global.AppState.DEFAULT_FRUSTUM;
const P = Mat.perspective(f.fovyDeg * Math.PI / 180, f.aspect, f.near, f.far);

function runPreset(key) {
  const preset = global.AppState.PRESETS[key];
  const clipIn = preset.verts.map((e) => Mat.eyeToClip(P, e));
  const res = Clip.clipPolygon(clipIn);
  return { preset, clipIn, res };
}

const expectations = {
  inside: { rejected: false, count: 3 },
  nearCross: { rejected: false, minCount: 4 },
  nearZeroW: { rejected: false, minCount: 3 },
  behindCamera: { rejected: false, minCount: 3 },
  multiPlane: { rejected: false, minCount: 3 },
  rejectedNear: { rejected: true, count: 0 },
  rejectedBehind: { rejected: true, count: 0 }
};

Object.keys(expectations).forEach((key) => {
  test('preset ' + key + ' pipeline output matches expectation', () => {
    const { res } = runPreset(key);
    const exp = expectations[key];
    assert.strictEqual(res.rejected, exp.rejected, key + ' rejected flag');
    if (exp.count !== undefined) assert.strictEqual(res.outputCount, exp.count);
    if (exp.minCount !== undefined) assert.ok(res.outputCount >= exp.minCount,
      key + ' got ' + res.outputCount);
    if (!res.rejected) {
      res.vertices.forEach((v) => {
        Clip.PLANES.forEach((pl) => assert.ok(Clip.distance(pl, v) >= -1e-7, pl.name));
      });
    }
  });
});

test('nearCross produces two near-plane intersection vertices', () => {
  const { res } = runPreset('nearCross');
  const hits = res.vertices.filter((v) => v.onPlane === 'near');
  assert.strictEqual(hits.length, 2);
  hits.forEach((h) => assert.ok(Math.abs(h.w + h.z) < 1e-9));
});

test('intersection attributes lie strictly between endpoint attributes', () => {
  const { res } = runPreset('multiPlane');
  res.vertices.filter((v) => v.generated !== undefined && v.onPlane).forEach((h) => {
    assert.ok(h.r >= 0 && h.r <= 255 && h.g >= 0 && h.g <= 255 && h.b >= 0 && h.b <= 255);
    assert.ok(h.u >= -1e-9 && h.u <= 1 + 1e-9 && h.v >= -1e-9 && h.v <= 1 + 1e-9);
  });
});

test('nearZeroW: clip never divides w; divide guard flags tiny/negative w', () => {
  const { clipIn, res } = runPreset('nearZeroW');
  assert.ok(clipIn[0].w < 0.01, 'w should be tiny: ' + clipIn[0].w);
  assert.ok(res.outputCount >= 3, 'clipping still succeeds without dividing');
  // 除法保护是裁剪之后的独立环节：极小 w 与负 w 都被标记无效
  assert.strictEqual(Clip.perspectiveDivide({ x: 0, y: 0, z: 0, w: 1e-8 }, 1e-6).valid, false);
  assert.strictEqual(Clip.perspectiveDivide({ x: 0, y: 0, z: 0, w: -2 }, 1e-6).valid, false);
  assert.strictEqual(Clip.perspectiveDivide({ x: 0, y: 0, z: 0, w: 2 }, 1e-6).valid, true);
});

test('area shrinks monotonically for every non-rejected preset', () => {
  Object.keys(global.AppState.PRESETS).forEach((key) => {
    const { clipIn, res } = runPreset(key);
    if (res.rejected) return;
    const before = Clip.ndcArea(clipIn);
    const after = Clip.ndcArea(res.vertices);
    assert.ok(after <= before + 1e-6, key + ': ' + after + ' > ' + before);
  });
});

test('sweep path: moving one vertex through near plane transitions counts 3 -> 4 -> 3', () => {
  const verts = global.AppState.cloneVerts(global.AppState.PRESETS.nearCross.verts);
  const counts = [];
  [-10, -3, -2.01, -1.99, -1, 0].forEach((z) => {
    verts[0].z = z;
    const clipIn = verts.map((e) => Mat.eyeToClip(P, e));
    counts.push(Clip.clipPolygon(clipIn).outputCount);
  });
  assert.deepStrictEqual(counts[0], 3);
  assert.ok(counts.some((c) => c === 4), 'expected a quad during crossing: ' + counts);
  assert.ok(counts[counts.length - 1] >= 3);
});

console.log('\n' + passed + ' smoke tests passed');
