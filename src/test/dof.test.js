'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../engine');
const dofMod = require('../dof');
const pipeline = require('../pipeline');

const W = 48, H = 32;

function params(overrides) {
  return engine.defaultParams(Object.assign({
    width: W, referenceWidth: W, focusDistance: 10, maxCocPx: 8,
    aperture: 1.4, focalLength: 0.085,
  }, overrides));
}

test('pinhole output is bit-identical to the input image', () => {
  const image = pipeline.impulseImage(W, H, 24, 16, 2, [4, 4, 4], 3.2, 40);
  const result = pipeline.runDoF(image, params({ aperture: 0 }));
  assert.equal(result.data.length, image.data.length);
  for (let i = 0; i < image.data.length; i++) {
    assert.equal(result.data[i], image.data[i]);
  }
});

test('focal-plane pixels are never modified (no over-blur at the focal band)', () => {
  const image = engine.createImage(W, H);
  for (let i = 0; i < image.depth.length; i++) image.depth[i] = 10;
  // High-contrast checker pattern at the focal depth.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = ((x + y) & 1) ? 0.9 : 0.1;
      const i = y * W + x;
      image.data[i * 3] = image.data[i * 3 + 1] = image.data[i * 3 + 2] = v;
    }
  }
  const result = pipeline.runDoF(image, params());
  for (let i = 0; i < image.data.length; i++) {
    assert.equal(result.data[i], image.data[i], 'focal pixel changed at ' + i);
  }
});

test('a thin foreground occluder blocks bright background bokeh (no leakage)', () => {
  const image = engine.createImage(W, H);
  for (let i = 0; i < image.depth.length; i++) image.depth[i] = 40;
  // Bright wall light behind the strip.
  for (let y = 10; y < 22; y++) {
    for (let x = 18; x < 30; x++) {
      const i = y * W + x;
      image.data[i * 3] = 8; image.data[i * 3 + 1] = 8; image.data[i * 3 + 2] = 4;
    }
  }
  // Thin but solid very-near dark strip running vertically through the light.
  for (let y = 0; y < H; y++) {
    for (let x = 22; x <= 26; x++) {
      const i = y * W + x;
      image.depth[i] = 3.2;
      image.data[i * 3] = 0.02;
      image.data[i * 3 + 1] = 0.02;
      image.data[i * 3 + 2] = 0.02;
    }
  }
  // Modest near-field blur so the solid strip is wider than its own CoC disc.
  const result = pipeline.runDoF(image, params({ foregroundScale: 0.35 }));
  // The bright background light (luminance 8) must not reach the strip centre:
  // the result there stays at the dark foreground colour. This is the actual
  // no-leakage guarantee; the coverage map visualises the near-field extent.
  const center = 16 * W + 24;
  assert.ok(result.fgCoverage[center] > 0.5, 'coverage ' + result.fgCoverage[center]);
  assert.ok(result.data[center * 3] < 0.1, 'leaked luminance ' + result.data[center * 3]);
  assert.ok(result.data[center * 3 + 2] < 0.1, 'leaked blue ' + result.data[center * 3 + 2]);

  // And just outside the strip the bright bokeh is still present on the wall,
  // proving the light genuinely sits behind the occluder.
  const beside = 16 * W + 18;
  assert.ok(result.data[beside * 3] > 0.5, 'missing background bokeh beside strip');
});

test('a bright far-field light forms a bounded bokeh disc no larger than maxCocPx', () => {
  const image = pipeline.impulseImage(W, H, 24, 16, 1, [6, 6, 6], 40, 40);
  const result = pipeline.runDoF(image, params({ maxCocPx: 5, backgroundScale: 1 }));
  const center = 16 * W + 24;
  // The disc spreads from a single pixel but must stay inside the cap.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d2 = (x - 24) * (x - 24) + (y - 16) * (y - 16);
      const i = y * W + x;
      if (d2 > 6 * 6) {
        assert.ok(result.data[i * 3] < 1e-4, 'bokeh leaked beyond cap at d2=' + d2);
      }
    }
  }
  assert.ok(result.data[center * 3] > 0, 'bokeh disc should brighten its centre');
});

test('foreground and background blur radii differ with separate scales', () => {
  const near = engine.computeCoc(Float32Array.from([3.2]), params({ foregroundScale: 2, backgroundScale: 0.25 }))[0];
  const far = engine.computeCoc(Float32Array.from([40]), params({ foregroundScale: 2, backgroundScale: 0.25 }))[0];
  assert.ok(near > 0 && far < 0);
  assert.ok(near > Math.abs(far) * 2);
});

test('depth-aware gather excludes foreground colours from the background pass', () => {
  const image = engine.createImage(W, H);
  for (let i = 0; i < image.depth.length; i++) {
    image.depth[i] = 40;
    image.data[i * 3] = 0.1; image.data[i * 3 + 1] = 0.1; image.data[i * 3 + 2] = 0.15;
  }
  // Saturated red foreground dot.
  for (let y = 15; y <= 17; y++) {
    for (let x = 23; x <= 25; x++) {
      const i = y * W + x;
      image.depth[i] = 3.2;
      image.data[i * 3] = 1; image.data[i * 3 + 1] = 0; image.data[i * 3 + 2] = 0;
    }
  }
  const result = dofMod.depthOfField(image, params(), engine.computeCoc(image.depth, params()));
  // A far background pixel well outside the foreground disc must contain no red.
  const far = (2 * W + 2) * 3;
  assert.ok(Math.abs(result.data[far] - 0.1) < 1e-6);
  assert.ok(Math.abs(result.data[far + 1] - 0.1) < 1e-6);
  assert.ok(Math.abs(result.data[far + 2] - 0.15) < 1e-6);
});
