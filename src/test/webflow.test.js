'use strict';

// Exercises the same engine wiring the browser demo uses (no DOM): build a
// scene, drive every view mode through the presenter math, and assert output.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../engine');
const dofMod = require('../dof');

const W = 120, H = 80;

function buildScene() {
  const image = engine.createImage(W, H);
  for (let i = 0; i < image.depth.length; i++) {
    image.depth[i] = 40;
    image.data[i * 3] = 0.1;
    image.data[i * 3 + 1] = 0.1;
    image.data[i * 3 + 2] = 0.15;
  }
  for (let y = 30; y < 50; y++) {
    for (let x = 40; x < 80; x++) {
      const i = y * W + x;
      image.depth[i] = 10;
      image.data[i * 3] = 0.8; image.data[i * 3 + 1] = 0.8; image.data[i * 3 + 2] = 0.8;
    }
  }
  for (let y = 20; y < 60; y++) {
    const i = y * W + 48;
    image.depth[i] = 3.2;
    image.data[i * 3] = 0.02; image.data[i * 3 + 1] = 0.02; image.data[i * 3 + 2] = 0.02;
  }
  return image;
}

test('browser-style flow renders every view mode without NaN', () => {
  const image = buildScene();
  for (const viewMode of ['dof', 'original', 'coc', 'layers', 'coverage']) {
    for (const scaleMode of ['pixel', 'physical']) {
      const params = engine.defaultParams({
        width: W, referenceWidth: W, focusDistance: 10, aperture: 1.4,
        maxCocPx: 16, scaleMode,
      });
      const coc = engine.computeCoc(image.depth, params);
      const result = params.aperture > 0
        ? dofMod.depthOfField(image, params, coc)
        : { data: image.data.slice(), fgCoverage: new Float32Array(W * H) };
      const source = viewMode === 'original' ? image.data : result.data;
      for (let k = 0; k < source.length; k++) {
        assert.ok(Number.isFinite(source[k]), 'NaN in ' + viewMode);
      }
      for (let k = 0; k < coc.length; k++) {
        assert.ok(Number.isFinite(coc[k]), 'NaN coc in ' + viewMode);
      }
    }
  }
});

test('browser aperture-zero branch returns the original buffer', () => {
  const image = buildScene();
  const params = engine.defaultParams({ width: W, referenceWidth: W, aperture: 0 });
  const coc = engine.computeCoc(image.depth, params);
  const result = dofMod.depthOfField(image, params, coc);
  assert.equal(result.data.length, image.data.length);
});
