import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIG,
  buildReference,
  classifyValue,
  isRunCurrent,
  mergeLocalHistogram,
  normalizeConfig,
  prefixSum,
  quantileBinsFromCdf,
} from "../js/core.js";
import { createPreset } from "../js/datasets.js";
import { compareResults } from "../js/compare.js";

const config = normalizeConfig(DEFAULT_CONFIG);

test("empty image produces zero counts and no quantiles", () => {
  const reference = buildReference(new Float32Array(0), config);
  assert.equal(reference.count, 0);
  assert.equal(reference.workgroups, 0);
  assert.equal(reference.lastGroupSize, 0);
  assert.deepEqual(Array.from(reference.histogram), Array(config.bins + 2).fill(0));
  assert.deepEqual(Array.from(reference.cdf), Array(config.bins).fill(0));
  assert.deepEqual(reference.quantileBins, Array(9).fill(null));
});

test("constant image puts every sample in one bucket", () => {
  const preset = createPreset("constant", config);
  const reference = buildReference(preset.values, config);
  const occupied = Array.from(reference.histogram)
    .map((count, index) => ({ count, index }))
    .filter((entry) => entry.count > 0);
  assert.equal(reference.count, 4_800);
  assert.equal(occupied.length, 1);
  assert.equal(occupied[0].count, 4_800);
  assert.equal(reference.cdf[occupied[0].index], 4_800);
  assert.equal(reference.validCount, 4_800);
  assert.equal(reference.nanCount, 0);
  assert.equal(reference.outOfRangeCount, 0);
});

test("non-integral workgroup has a partial final group", () => {
  const preset = createPreset("partial", config);
  const reference = buildReference(preset.values, config);
  assert.equal(reference.count, 6_767);
  assert.equal(reference.workgroups, 27);
  assert.equal(reference.lastGroupSize, 111);
  assert.equal(
    reference.workgroups * config.workgroupSize >= reference.count,
    true,
  );

  const merged = mergeLocalHistogram(
    reference.localHistogram,
    reference.workgroups,
    config.bins,
  );
  assert.deepEqual(Array.from(merged), Array.from(reference.histogram));
});

test("NaN and out-of-range values are counted separately", () => {
  const preset = createPreset("mixed", config);
  const reference = buildReference(preset.values, config);
  assert.equal(reference.count, 6_144);
  assert.equal(reference.nanCount, 3);
  assert.equal(reference.outOfRangeCount, 4);
  assert.equal(
    reference.validCount + reference.nanCount + reference.outOfRangeCount,
    reference.count,
  );
  assert.equal(reference.cdf[config.bins - 1], reference.validCount);
  assert.equal(
    reference.histogram.reduce((sum, value) => sum + value, 0),
    reference.count,
  );
});

test("classification includes both range endpoints", () => {
  assert.equal(classifyValue(config.min, config).index, 0);
  assert.equal(classifyValue(config.max, config).index, config.bins - 1);
  assert.equal(classifyValue(config.min - 0.0001, config).kind, "outOfRange");
  assert.equal(classifyValue(config.max + 0.0001, config).kind, "outOfRange");
  assert.equal(classifyValue(Number.NaN, config).kind, "nan");
  assert.equal(
    classifyValue(Number.POSITIVE_INFINITY, config).kind,
    "outOfRange",
  );
});

test("prefix sum and quantile search use exact integer counts", () => {
  const counts = Uint32Array.from([2, 0, 5, 1, 4]);
  assert.deepEqual(Array.from(prefixSum(counts)), [2, 2, 7, 8, 12]);
  assert.deepEqual(quantileBinsFromCdf(prefixSum(counts), counts.length), [
    0, 0, 0, 2, 2, 4, 4, 4, 4,
  ]);
});

test("CPU candidate passes every parity check", () => {
  const preset = createPreset("mixed", config);
  const reference = buildReference(preset.values, config);
  const candidate = {
    globalHistogram: reference.histogram,
    localHistogram: reference.localHistogram,
    mergedHistogram: mergeLocalHistogram(
      reference.localHistogram,
      reference.workgroups,
      config.bins,
    ),
    globalCdf: reference.cdf,
    localCdf: reference.cdf,
    globalQuantileBins: reference.quantileBins,
    localQuantileBins: reference.quantileBins,
  };
  const comparison = compareResults(reference, candidate);
  assert.equal(comparison.allPass, true);
  assert.equal(comparison.totalDifference, 0);
  assert.equal(
    comparison.checks.every((check) => check.differences === 0),
    true,
  );
});

test("reference uses float32 values to match GPU input", () => {
  const values = Float32Array.from([0.1, 0.1 + 1e-9, -0.15000001]);
  const reference = buildReference(values, config);
  assert.equal(reference.count, 3);
  assert.equal(reference.histogram.reduce((sum, value) => sum + value, 0), 3);
  assert.equal(reference.nanCount, 0);
});

test("stale async readbacks cannot be applied to a newer input", () => {
  assert.equal(isRunCurrent(4, 9, 4, 9), true);
  assert.equal(isRunCurrent(3, 9, 4, 9), false);
  assert.equal(isRunCurrent(4, 8, 4, 9), false);
  assert.equal(isRunCurrent(3, 8, 4, 9), false);
});
