import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefilter, downsample, DOWN_WEIGHTS } from '../src/filters.js';
import { runBloom } from '../src/bloom.js';
import { makeScene } from '../src/scene.js';
import {
  totalLuminance,
  spatialStats,
  levelsForRadius,
  buildMipChain,
} from '../src/math.js';

test('downsample weights are normalized and all positive', () => {
  assert.equal(DOWN_WEIGHTS.length, 4);
  // Each bucket contains 4 taps; the 16 taps together must sum to 1.
  const sum =
    4 * DOWN_WEIGHTS[0] +
    4 * DOWN_WEIGHTS[1] +
    4 * DOWN_WEIGHTS[2] +
    4 * DOWN_WEIGHTS[3];
  assert.ok(Math.abs(sum - 1) < 1e-12, `weight sum ${sum}`);
  assert.ok(DOWN_WEIGHTS.every((w) => w > 0));
});

test('downsample preserves energy on a flat field', () => {
  const width = 16;
  const height = 16;
  const source = new Float32Array(width * height * 3).fill(0.7);
  const result = downsample(source, width, height);
  assert.equal(result.width, 8);
  assert.equal(result.height, 8);
  for (const v of result.buffer) {
    assert.ok(Math.abs(v - 0.7) < 1e-6);
  }
});

test('soft knee is exactly zero below the threshold-knee boundary', () => {
  const source = new Float32Array(3 * 5);
  const values = [0.0, 0.25, 0.5, 0.9, 1.5];
  values.forEach((v, i) => {
    source[i * 3] = v;
    source[i * 3 + 1] = v;
    source[i * 3 + 2] = v;
  });
  const filtered = prefilter(source, 5, 1, 1.0, 0.5);
  // knee = 0.5, so values at or below 0.5 are fully suppressed.
  for (let i = 0; i < 3; i++) {
    assert.equal(filtered[i * 3], 0);
  }
  // Values above threshold + knee pass through unchanged.
  assert.ok(Math.abs(filtered[4 * 3] - 1.5) < 1e-10);
  // Ramp region is partial and monotonic.
  assert.ok(filtered[3 * 3] > 0 && filtered[3 * 3] < 0.9);
  // Multiplier at the threshold itself is 0.375 (UE quadratic-knee midpoint).
  const mid = prefilter(new Float32Array([1, 1, 1]), 1, 1, 1.0, 0.5);
  assert.ok(Math.abs(mid[0] - 0.375) < 1e-10);
});

test('disabling bloom leaves the source image bit-for-bit untouched', () => {
  const scene = makeScene(128, 96);
  const result = runBloom(scene.buffer, 128, 96, { enabled: false });
  assert.equal(result.enabled, false);
  assert.deepEqual(Array.from(result.composite), Array.from(scene.buffer));
  assert.equal(totalLuminance(result.bloom, 128, 96), 0);
});

test('bloom never lifts dark background or sub-threshold pixels', () => {
  const scene = makeScene(128, 96);
  const result = runBloom(scene.buffer, 128, 96, {
    threshold: 1,
    kneeScale: 0.5,
    radiusFraction: 0.2,
  });
  // No global haze: black pixels far from both emitters must stay black.
  // (Bloom is allowed to spill locally; a whole-frame lift is the failure.)
  let farBlackHaze = 0;
  const farFromEmitters = (x, y) => {
    const point = scene.emitters.point;
    const line = scene.emitters.line;
    const dPoint = Math.hypot(x - point.x, y - point.y);
    const dLine = Math.abs(y - line.y);
    const insideLineX = x >= line.x0 - 24 && x <= line.x1 + 24;
    return dPoint > 28 && !(insideLineX && dLine < 24);
  };
  for (let i = 0; i < scene.buffer.length; i += 3) {
    const pixel = i / 3;
    const x = pixel % 128;
    const y = Math.floor(pixel / 128);
    if (scene.buffer[i] === 0 && farFromEmitters(x, y)) {
      farBlackHaze = Math.max(
        farBlackHaze,
        result.bloom[i],
        result.bloom[i + 1],
        result.bloom[i + 2]
      );
    }
  }
  assert.ok(
    farBlackHaze < 1e-5,
    `global haze ${farBlackHaze} should be numerical noise only`
  );

  // Sub-threshold gray patch: pixels on its bloom-free left edge stay at 0.3.
  const farIndex = (Math.floor(96 * 0.81) * 128 + Math.floor(128 * 0.07)) * 3;
  assert.ok(Math.abs(result.composite[farIndex] - 0.3) < 1e-6);
});

test('declared visual radius stays constant when only the viewport changes', () => {
  const small = makeScene(160, 120);
  const large = makeScene(320, 240);
  const options = { threshold: 1, kneeScale: 0.5, radiusFraction: 0.18 };
  const smallResult = runBloom(small.buffer, 160, 120, options);
  const largeResult = runBloom(large.buffer, 320, 240, options);

  const smallStats = spatialStats(
    smallResult.bloom,
    160,
    120,
    1,
    false
  );
  const largeStats = spatialStats(
    largeResult.bloom,
    320,
    240,
    1,
    false
  );

  // Absolute pixel radii scale with resolution...
  const ratio = largeStats.e90 / smallStats.e90;
  assert.ok(ratio > 1.7 && ratio < 2.3, `pixel radius ratio ${ratio}`);
  // ...while the viewport-relative radius matches the declared fraction.
  const smallFraction = smallStats.e90 / 120;
  const largeFraction = largeStats.e90 / 240;
  assert.ok(
    Math.abs(smallFraction - largeFraction) / smallFraction < 0.02,
    `fractions ${smallFraction} vs ${largeFraction}`
  );
  assert.ok(
    Math.abs(smallStats.sigma / 120 - largeStats.sigma / 240) < 0.01,
    'sigma viewport fraction should also be resolution-independent'
  );
});

test('level count derives from the viewport-relative radius', () => {
  assert.equal(levelsForRadius(0.1, 1080), levelsForRadius(0.1, 540) + 1);
  const chain = buildMipChain(320, 240);
  const levels = Math.min(
    chain.length,
    levelsForRadius(0.15, 240)
  );
  assert.ok(levels >= 3 && levels <= chain.length);
});

test('per-mip energy is non-increasing and the edge decays smoothly', () => {
  const scene = makeScene(160, 120);
  const result = runBloom(scene.buffer, 160, 120, {
    threshold: 1,
    kneeScale: 0.5,
    radiusFraction: 0.25,
  });
  assert.ok(result.levels.length >= 3);

  const energies = result.levels.map((level) =>
    totalLuminance(level.buffer, level.width, level.height)
  );
  for (let i = 1; i < energies.length; i++) {
    assert.ok(energies[i] <= energies[i - 1] * 1.02);
  }

  // Smooth decay: successive outward rings around the point in level 0 must
  // not contain a negative slope reversal larger than numerical noise.
  const level0 = result.levels[0];
  const cx = Math.round(scene.emitters.point.x);
  const cy = Math.round(scene.emitters.point.y);
  const ringMeans = [];
  for (let radius = 1; radius <= 8; radius++) {
    let sum = 0;
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= 160 || y >= 120) continue;
        const index = (y * 160 + x) * 3;
        sum +=
          0.2126 * level0.buffer[index] +
          0.7152 * level0.buffer[index + 1] +
          0.0722 * level0.buffer[index + 2];
        count++;
      }
    }
    ringMeans.push(sum / count);
  }
  for (let i = 1; i < ringMeans.length; i++) {
    assert.ok(
      ringMeans[i] <= ringMeans[i - 1] + 1e-6,
      `non-monotonic ring at ${i}: ${ringMeans[i - 1]} -> ${ringMeans[i]}`
    );
  }
});

test('upsample weights change the result but keep dark regions black', () => {
  const scene = makeScene(128, 96);
  const base = runBloom(scene.buffer, 128, 96, {
    radiusFraction: 0.2,
    upsampleWeights: [1, 1, 1, 1],
  });
  const weighted = runBloom(scene.buffer, 128, 96, {
    radiusFraction: 0.2,
    upsampleWeights: [1, 0.25, 0.1, 0.05],
  });
  assert.notDeepEqual(
    Array.from(weighted.bloom),
    Array.from(base.bloom)
  );
  const baseEnergy = totalLuminance(base.bloom, 128, 96);
  const weightedEnergy = totalLuminance(weighted.bloom, 128, 96);
  assert.ok(weightedEnergy < baseEnergy);
});

test('tiny declared radius uses a single mip level without crashing', () => {
  const scene = makeScene(128, 96);
  const result = runBloom(scene.buffer, 128, 96, {
    radiusFraction: 0.001,
    upsampleWeights: [0.5],
  });
  assert.equal(result.levels.length, 1);
  // The explicit level-0 weight is honored.
  const expected = totalLuminance(
    result.levels[0].buffer,
    128,
    96
  );
  assert.ok(
    Math.abs(totalLuminance(result.bloom, 128, 96) - expected * 0.5) < 1e-6
  );
});

test('a threshold above every pixel produces an empty bloom buffer', () => {
  const scene = makeScene(128, 96);
  const result = runBloom(scene.buffer, 128, 96, {
    threshold: 100,
    kneeScale: 0.1,
    radiusFraction: 0.2,
  });
  assert.equal(totalLuminance(result.bloom, 128, 96), 0);
  assert.deepEqual(Array.from(result.composite), Array.from(scene.buffer));
});
