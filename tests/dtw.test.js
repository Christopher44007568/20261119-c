import assert from "node:assert/strict";
import test from "node:test";
import { alignClips } from "../src/alignment.js";
import { DtwInputError, normalizeClip } from "../src/dtw.js";
import { resampledClipToJSON, resampleSegment } from "../src/resample.js";
import { getScenario } from "../src/samples.js";

function assertMonotonic(path) {
  for (let index = 1; index < path.length; index += 1) {
    const dr = path[index].ref - path[index - 1].ref;
    const dt = path[index].target - path[index - 1].target;
    assert.ok(dr >= 0 && dt >= 0, "path must be monotonic");
    assert.ok(dr <= 1 && dt <= 1, "path must advance one frame at a time");
    assert.ok(dr + dt > 0, "path must not stall");
  }
}

function meanLinearDeviation(alignment) {
  const n = alignment.reference.frames.length;
  const m = alignment.target.frames.length;
  let total = 0;
  for (let index = 0; index < n; index += 1) {
    total += Math.abs(alignment.mapping[index] - (index * (m - 1)) / (n - 1));
  }
  return total / n;
}

test("different speeds still produce a low-cost monotonic path", () => {
  const scenario = getScenario("speed");
  const alignment = alignClips(scenario.reference, scenario.target, {
    anchors: scenario.anchors,
  });

  assertMonotonic(alignment.path);
  assert.equal(alignment.path[0].ref, 0);
  assert.equal(alignment.path[0].target, 0);
  assert.equal(alignment.path.at(-1).ref, 120);
  assert.equal(alignment.path.at(-1).target, 83);
  assert.ok(alignment.metrics.endpointError.max < 0.01);
  assert.ok(alignment.metrics.meanCost < 0.01);
  assert.ok(alignment.stretch.stats.p90 / alignment.stretch.stats.p10 > 1.3);
  assert.ok(
    alignment.path.some(
      (pair) => pair.ref === scenario.anchors[0].ref && pair.target === scenario.anchors[0].target,
    ),
    "the optimal path must pass through every user anchor",
  );
});

test("local pause creates a held-target run instead of uniform scaling", () => {
  const scenario = getScenario("pause");
  const alignment = alignClips(scenario.reference, scenario.target, {
    anchors: scenario.anchors,
  });
  assertMonotonic(alignment.path);

  assert.ok(alignment.metrics.steps.targetHold > 25);
  assert.ok(alignment.metrics.steps.referenceHold > 15);
  assert.ok(alignment.stretch.stats.max > 1.5);
  assert.ok(meanLinearDeviation(alignment) > 2, "path must not be a linear time scale");
  assert.ok(alignment.metrics.anchorErrors[0].error < 0.01);
});

test("missing frames are bridged while preserving endpoint error metrics", () => {
  const scenario = getScenario("missing");
  const alignment = alignClips(scenario.reference, scenario.target, {
    anchors: scenario.anchors,
  });
  assertMonotonic(alignment.path);
  assert.equal(new Set(alignment.path.map((pair) => pair.target)).size, 94);
  assert.equal(alignment.metrics.endpointError.start, 0);
  assert.ok(alignment.metrics.endpointError.end < 0.01);
  assert.ok(alignment.metrics.meanCost < 0.01);
});

test("crossed anchors are rejected with a specific error", () => {
  const scenario = getScenario("conflict");
  assert.throws(
    () =>
      alignClips(scenario.reference, scenario.target, {
        anchors: scenario.anchors,
      }),
    (error) =>
      error instanceof DtwInputError &&
      error.code === "ANCHOR_ORDER_CONFLICT" &&
      error.message.includes("锚点顺序冲突"),
  );
});

test("anchors sharing a timeline coordinate are rejected as non-strict", () => {
  const scenario = getScenario("speed");
  assert.throws(
    () =>
      alignClips(scenario.reference, scenario.target, {
        anchors: [
          { ref: 20, target: 10 },
          { ref: 20, target: 30 },
        ],
      }),
    (error) => error.code === "ANCHOR_ORDER_CONFLICT",
  );
});

test("resampling exports only the selected anchor-bounded segment", () => {
  const scenario = getScenario("pause");
  const alignment = alignClips(scenario.reference, scenario.target, {
    anchors: scenario.anchors,
  });
  assert.equal(alignment.segments.length, 2);
  const result = resampleSegment(alignment, 0, { frameCount: 36 });
  const start = alignment.segments[0].start;
  const end = alignment.segments[0].end;

  assert.equal(result.frameCount, 36);
  assert.equal(result.frames[0].time, alignment.reference.frames[start.ref].time);
  assert.equal(result.frames.at(-1).time, alignment.reference.frames[end.ref].time);
  assert.ok(result.frames[0].time < alignment.reference.frames.at(-1).time);
  assert.deepEqual(result.correspondence[0], {
    referenceIndex: start.ref,
    targetIndex: start.target,
  });
  assert.deepEqual(result.correspondence.at(-1), {
    referenceIndex: end.ref,
    targetIndex: end.target,
  });
  for (const [frameIndex, targetIndex] of [
    [0, start.target],
    [result.frames.length - 1, end.target],
  ]) {
    const source = alignment.target.frames[targetIndex].positions.flat();
    const output = alignment.target.jointNames.flatMap((name) =>
      result.frames[frameIndex].joints[name],
    );
    output.forEach((value, component) => assert.ok(Math.abs(value - source[component]) < 1e-12));
  }
  for (let index = 1; index < result.correspondence.length; index += 1) {
    assert.ok(result.correspondence[index].referenceIndex >= result.correspondence[index - 1].referenceIndex);
    assert.ok(result.correspondence[index].targetIndex >= result.correspondence[index - 1].targetIndex);
  }
  assert.ok(result.frames[0].joints.head.every(Number.isFinite));
  assert.equal(resampledClipToJSON(result).frames.length, 36);
});

test("stretch histogram and endpoint metrics are internally consistent", () => {
  const scenario = getScenario("speed");
  const alignment = alignClips(scenario.reference, scenario.target, {
    anchors: scenario.anchors,
  });
  const { values, stats, histogram } = alignment.stretch;
  assert.equal(values.length, alignment.stretch.profile.length);
  assert.ok(values.every((value) => Number.isFinite(value) && value >= 0));
  assert.ok(stats.min <= stats.p10 && stats.p10 <= stats.median);
  assert.ok(stats.median <= stats.p90 && stats.p90 <= stats.max);
  assert.equal(
    histogram.bins.reduce((sum, bin) => sum + bin.count, 0),
    values.length,
  );
  assert.ok(alignment.metrics.endpointError.start >= 0);
  assert.ok(alignment.metrics.endpointError.end >= 0);
});

test("normalization accepts joint arrays and infers timestamp spacing", () => {
  const clip = normalizeClip({
    name: "array input",
    fps: 10,
    frames: [
      [[0, 0, 0], [1, 1, 1]],
      [[1, 0, 0], [1, 2, 1]],
    ],
  });
  assert.deepEqual(clip.jointNames, ["joint_0", "joint_1"]);
  assert.equal(clip.frames[1].time, 0.1);
  assert.equal(clip.dimensions, 3);
});
