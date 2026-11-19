import test from "node:test";
import assert from "node:assert/strict";

import {
  composeTRS,
  identity,
  invert,
  maxAbsDifference,
  multiply,
  normalMatrix,
  transformPoint,
} from "../src/math.js";
import {
  checkInverseBindMatrices,
  computeBoneWorlds,
  computeSkinningMatrices,
  createBindPose,
  createSkeleton,
} from "../src/skeleton.js";
import { normalizeSkinWeights } from "../src/weights.js";

test("matrix inverse round-trips affine transforms", () => {
  const matrix = composeTRS([2, -1, 0.5], [0.2, -0.1, 0.3, 0.927], [1, 2, 0.5]);
  const product = multiply(matrix, invert(matrix));
  assert.ok(maxAbsDifference(product, identity()) < 1e-6);
  assert.deepEqual(
    transformPoint(matrix, [1, 2, 3]).map((value) => Number(value.toFixed(5))),
    [0.3171, 1.83, 3.3986],
  );
});

test("inverse bind matrices reconstruct identity in bind pose", () => {
  const skeleton = createSkeleton([
    { name: "root", parent: -1, position: [1, 0, 0], scale: [1, 2, 1] },
    { name: "child", parent: 0, position: [0, 2, 0], rotation: [0, 0, 0.2, 0.98] },
  ]);
  const check = checkInverseBindMatrices(skeleton);
  assert.equal(check.ok, true);
  assert.ok(check.worstError < 1e-5);

  const pose = createBindPose(skeleton);
  const matrices = pose.map((transform) =>
    composeTRS(transform.position, transform.rotation, transform.scale));
  const skin = computeSkinningMatrices(skeleton, matrices);
  skin.forEach((matrix) => {
    assert.ok(maxAbsDifference(matrix, identity()) < 1e-7);
  });
});

test("inverse bind checker reports a corrupted inverse", () => {
  const skeleton = createSkeleton([
    { name: "root", parent: -1 },
    { name: "child", parent: 0, position: [0, 1, 0] },
  ]);
  skeleton.bones[1].inverseBind[12] = 0.5;
  const check = checkInverseBindMatrices(skeleton);
  assert.equal(check.ok, false);
  assert.equal(check.failures[0].bone, "child");
});

test("non-normalized weights are divided by their sum", () => {
  const result = normalizeSkinWeights(
    new Uint16Array([0, 1, 0, 0]),
    new Float32Array([2, 1, 0, 0]),
    2,
  );
  assert.deepEqual(
    Array.from(result.weights).map((value) => Number(value.toFixed(6))),
    [0.666667, 0.333333, 0, 0],
  );
  assert.equal(result.report.normalizedVertexCount, 1);
  assert.equal(result.report.zeroWeightVertexCount, 0);
});

test("zero weights use the explicit fallback bone policy", () => {
  const result = normalizeSkinWeights(
    new Uint16Array([3, 3, 3, 3]),
    new Float32Array([0, 0, 0, 0]),
    4,
    { fallbackJoint: 2 },
  );
  assert.deepEqual(Array.from(result.joints), [2, 0, 0, 0]);
  assert.deepEqual(Array.from(result.weights), [1, 0, 0, 0]);
  assert.equal(result.report.zeroWeightVertexCount, 1);
  assert.equal(result.report.fallbackVertexCount, 1);
});

test("invalid and negative weights are zeroed and reported", () => {
  const result = normalizeSkinWeights(
    new Uint16Array([0, 1, 2, 9]),
    new Float32Array([1, NaN, -1, 0.5]),
    3,
  );
  assert.deepEqual(Array.from(result.joints), [0, 0, 0, 0]);
  assert.deepEqual(Array.from(result.weights), [1, 0, 0, 0]);
  assert.equal(result.report.invalidWeightCount, 2);
  assert.equal(result.report.invalidJointCount, 1);
});

test("drop policy leaves zero-weight vertices unweighted", () => {
  const result = normalizeSkinWeights(
    new Uint16Array([0, 0, 0, 0]),
    new Float32Array([0, 0, 0, 0]),
    1,
    { zeroWeightPolicy: "drop" },
  );
  assert.deepEqual(Array.from(result.weights), [0, 0, 0, 0]);
  assert.equal(result.report.droppedVertexCount, 1);
});

test("bone worlds follow the hierarchy", () => {
  const skeleton = createSkeleton([
    { name: "root", parent: -1, position: [1, 0, 0] },
    { name: "child", parent: 0, position: [0, 2, 0] },
    { name: "leaf", parent: 1, position: [0, 0, 3] },
  ]);
  const locals = createBindPose(skeleton).map((transform) =>
    composeTRS(transform.position, transform.rotation, transform.scale));
  const worlds = computeBoneWorlds(skeleton, locals);
  assert.deepEqual(Array.from(worlds[2].slice(12, 15)), [1, 2, 3]);
});
