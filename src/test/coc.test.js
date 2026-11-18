'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../engine');

function params(overrides) {
  return engine.defaultParams(Object.assign({
    width: 100, referenceWidth: 100, focusDistance: 10, maxCocPx: 20,
  }, overrides));
}

test('aperture 0 produces an all-zero signed CoC (pinhole)', () => {
  const depth = Float32Array.from([3, 10, 40]);
  const coc = engine.computeCoc(depth, params({ aperture: 0 }));
  assert.deepEqual(Array.from(coc), [0, 0, 0]);
});

test('signed convention: near positive, focal zero, far negative', () => {
  const depth = Float32Array.from([3.2, 10, 40]);
  const coc = engine.computeCoc(depth, params({ aperture: 1.4 }));
  assert.ok(coc[0] > 0, 'near field must be positive');
  assert.equal(coc[1], 0, 'focal depth must be zero');
  assert.ok(coc[2] < 0, 'far field must be negative');
});

test('foreground and background scales apply independently', () => {
  const depth = Float32Array.from([5, 20]);
  const base = engine.computeCoc(depth, params({ aperture: 1.4, foregroundScale: 1, backgroundScale: 1 }));
  const scaled = engine.computeCoc(depth, params({ aperture: 1.4, foregroundScale: 2, backgroundScale: 0.5 }));
  assert.ok(Math.abs(scaled[0] - base[0] * 2) < 1e-5);
  assert.ok(Math.abs(scaled[1] - base[1] * 0.5) < 1e-5);
});

test('CoC magnitude is hard-capped by maxCocPx (bounded bokeh)', () => {
  const depth = Float32Array.from([0.5, 1000]);
  const coc = engine.computeCoc(depth, params({ aperture: 0.5, maxCocPx: 4 }));
  assert.ok(Math.abs(coc[0]) <= 4 + 1e-6);
  assert.ok(Math.abs(coc[1]) <= 4 + 1e-6);
});

test('pixel mode keeps radius in pixels across resolutions', () => {
  const depth = Float32Array.from([5]);
  const ref = engine.computeCoc(depth, params({ width: 100, referenceWidth: 100, scaleMode: 'pixel' }))[0];
  const half = engine.computeCoc(depth, params({ width: 50, referenceWidth: 100, scaleMode: 'pixel' }))[0];
  assert.ok(Math.abs(ref - half) < 1e-5, 'pixel radius must not change with resolution');
});

test('physical mode scales radius linearly with width', () => {
  const depth = Float32Array.from([5]);
  const full = engine.computeCoc(depth, params({ width: 100, scaleMode: 'physical' }))[0];
  const half = engine.computeCoc(depth, params({ width: 50, scaleMode: 'physical' }))[0];
  assert.ok(Math.abs(full - 2 * half) < 1e-5, 'physical CoC halves when pixel count halves');
});

test('smaller f-number gives strictly larger blur', () => {
  const depth = Float32Array.from([5]);
  const wide = engine.computeCoc(depth, params({ aperture: 1.0 }))[0];
  const narrow = engine.computeCoc(depth, params({ aperture: 4.0 }))[0];
  assert.ok(wide > narrow);
});
