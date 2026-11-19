import test from 'node:test';
import assert from 'node:assert/strict';
import { CageDeformer, WeightCache, cageFingerprint } from '../src/cage-model.js';
import { cycleEdges } from '../src/geometry.js';

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 3 },
  { x: 0, y: 3 },
];

test('weight cache recomputes after a topology change', () => {
  const cache = new WeightCache();
  const deformer = new CageDeformer({ vertices: square, resolution: 4, cache });
  const firstFingerprint = deformer.weightRecord.fingerprint;
  const firstRevision = deformer.topologyRevision;

  const result = deformer.splitEdge(0);
  assert.equal(result.ok, true);
  assert.equal(deformer.topologyRevision, firstRevision + 1);
  assert.notEqual(deformer.weightRecord.fingerprint, firstFingerprint);
  assert.equal(deformer.cache.misses, 2);
  assert.equal(deformer.weightRecord.weights.length, deformer.mesh.vertices.length);
  assert.ok(deformer.weightRecord.sums.every((sum) => Math.abs(sum - 1) < 1e-9));
});

test('invalid drag keeps the previous valid mesh and cached weights', () => {
  const deformer = new CageDeformer({ vertices: square, resolution: 3 });
  const meshBefore = deformer.posedMeshVertices.map((point) => ({ ...point }));
  const weightsBefore = deformer.weightRecord.weights;

  const result = deformer.setCageVertex(2, 0.4, -0.6);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /自交/);
  assert.deepEqual(deformer.posedMeshVertices, meshBefore);
  assert.equal(deformer.weightRecord.weights, weightsBefore);
  assert.equal(deformer.lastValid.posedMeshVertices.length, meshBefore.length);
});

test('non-closed topology is rejected without replacing the last valid result', () => {
  const deformer = new CageDeformer({ vertices: square, resolution: 3 });
  const revisionBefore = deformer.topologyRevision;
  const meshBefore = deformer.posedMeshVertices.map((point) => ({ ...point }));

  const result = deformer.applyTopology(square, [[0, 1], [1, 2], [2, 3]]);
  assert.equal(result.ok, false);
  assert.equal(deformer.topologyRevision, revisionBefore);
  assert.deepEqual(deformer.posedMeshVertices, meshBefore);
  assert.ok(deformer.lastError.message.length > 0);
});

test('resolved cache fingerprint changes with topology but is deterministic', () => {
  const first = cageFingerprint(square, cycleEdges(4), 4);
  const second = cageFingerprint(square, cycleEdges(4), 4);
  const changed = cageFingerprint([...square, { x: 2, y: 0 }], cycleEdges(5), 4);
  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.match(first, /^cage-[0-9a-f]{8}-4v-4r$/);
});
