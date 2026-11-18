import assert from 'node:assert/strict';
import { test } from 'node:test';
import { solveFold, validatePattern } from '../src/core/folding.js';
import { fourFoldStrip, degreeFourLoop, degreesState } from '../src/core/patterns.js';
import { triangulate, signedArea, trianglesIntersect } from '../src/math/geometry.js';

test('triangle SAT distinguishes penetration from mere contact', () => {
  const crossingA = [
    [-1, 0, -1],
    [1, 0, -1],
    [0, 0, 1],
  ];
  const crossingB = [
    [0, -1, -1],
    [0, 1, -1],
    [0, 0, 1],
  ];
  assert.ok(trianglesIntersect(crossingA, crossingB));
  const edgeA = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const edgeB = [
    [1, 0, 0],
    [2, 0, 0],
    [1, 1, 0],
  ];
  assert.equal(trianglesIntersect(edgeA, edgeB), false);
  const overlapB = [
    [0.25, -0.25, 0],
    [1.25, -0.25, 0],
    [0.25, 1.25, 0],
  ];
  assert.ok(trianglesIntersect(edgeA, overlapB));
});

test('triangulation covers a CCW quad without overlap', () => {
  const quad = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const tris = triangulate(quad);
  assert.equal(tris.length, 2);
  const triArea = tris.reduce((sum, [a, b, c]) => {
    const pts = [quad[a], quad[b], quad[c]];
    return sum + Math.abs(signedArea(pts));
  }, 0);
  assert.ok(Math.abs(triArea - 1) < 1e-12);
});

test('strip preserves every edge length for arbitrary driven angles', () => {
  const pattern = fourFoldStrip();
  const state = degreesState(pattern, {
    F0: 60,
    F1: 110,
    F2: -0,
    F3: 45,
  });
  const result = solveFold(pattern, state);
  assert.ok(result.ok);
  assert.equal(result.tree.closureFoldIds.length, 0);
  assert.ok(result.lengths.maxRelative < 1e-12);
  assert.ok(result.accepted);
});

test('flat state keeps all panels in the z=0 plane with unit normals', () => {
  const pattern = fourFoldStrip();
  const state = degreesState(pattern, {});
  const { geometry } = solveFold(pattern, state);
  for (const g of geometry.values()) {
    for (const p of g.world3d) assert.ok(Math.abs(p[2]) < 1e-12);
    assert.ok(Math.abs(g.normal[2] - 1) < 1e-12);
  }
});

test('loop pattern rejects incompatible fold angles with a position residual', () => {
  const pattern = degreeFourLoop();
  const state = degreesState(pattern, { F0: 60, F1: 20, F2: 60, F3: 30 });
  const result = solveFold(pattern, state);
  assert.ok(result.ok);
  assert.ok(result.tree.closureFoldIds.length === 1);
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes('闭环约束残差超差'));
  const closure = result.closure[0];
  assert.ok(closure.positionResidual > result.posTol);
});

test('loop book-fold branch closes exactly and stays intersection free', () => {
  const pattern = degreeFourLoop();
  // The orthogonal 4-vertex folds non-trivially along the book-fold branch:
  // the collinear hinge pair rotates while the perpendicular pair stays flat.
  const state = degreesState(pattern, { F0: 40, F2: 40 });
  const result = solveFold(pattern, state);
  const closure = result.closure[0];
  assert.ok(
    closure.positionResidual < 1e-9,
    `residual ${closure.positionResidual}`,
  );
  assert.ok(closure.angleResidual < 1e-9);
  assert.equal(result.intersections.length, 0);
  assert.ok(result.accepted);
});

test('flat sheet is accepted for both tree and loop patterns', () => {
  for (const make of [fourFoldStrip, degreeFourLoop]) {
    const pattern = make();
    const result = solveFold(pattern, degreesState(pattern, {}));
    assert.ok(result.accepted, result.reasons.join(','));
    assert.equal(result.intersections.length, 0);
  }
});

test('deep strip folding produces panel penetration that is marked', () => {
  const pattern = fourFoldStrip();
  const state = degreesState(pattern, { F2: 180 });
  const result = solveFold(pattern, state);
  assert.ok(result.intersections.length > 0);
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes('非相邻面板互相穿透'));
});

test('bad topology is rejected before solving', () => {
  const pattern = fourFoldStrip();
  pattern.folds[0].edge = [0, 2];
  assert.ok(validatePattern(pattern) !== null);
});
