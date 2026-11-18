import assert from 'node:assert/strict';
import { test } from 'node:test';
import { solveFold } from '../src/core/folding.js';
import { fourFoldStrip, degreeFourLoop, degreesState } from '../src/core/patterns.js';
import { buildScene } from '../src/render/scene.js';

test('scene emits filled triangles and crease lines for every panel', () => {
  const pattern = fourFoldStrip();
  const result = solveFold(pattern, degreesState(pattern, { F0: 45 }));
  const scene = buildScene(pattern, result);
  assert.ok(scene.fill.positions.length > 0);
  assert.ok(scene.lines.positions.length > 0);
  assert.equal(scene.fill.positions.length, scene.fill.colors.length);
  assert.equal(scene.fill.positions.length, scene.fill.normals.length);
  assert.equal(scene.lines.positions.length, scene.lines.colors.length);
});

test('intersecting panels are colored red in the fill buffer', () => {
  const pattern = fourFoldStrip();
  const result = solveFold(pattern, degreesState(pattern, { F2: 180 }));
  assert.ok(result.intersections.length > 0);
  const scene = buildScene(pattern, result);
  const redPanels = new Set(result.intersections.flatMap((v) => v.panels));
  assert.ok(redPanels.size > 0);
  let redVertices = 0;
  for (let i = 0; i < scene.fill.colors.length; i += 3) {
    if (
      scene.fill.colors[i] > 0.95 &&
      scene.fill.colors[i + 1] < 0.25 &&
      scene.fill.colors[i + 2] < 0.25
    ) {
      redVertices++;
    }
  }
  assert.ok(redVertices > 0);
});

test('active fold adds a hinge gizmo and normals add one arrow per panel', () => {
  const pattern = degreeFourLoop();
  const result = solveFold(pattern, degreesState(pattern, { F0: 30, F2: 30 }));
  const baseline = buildScene(pattern, result).lines.positions.length;
  const withGizmo = buildScene(pattern, result, {
    activeFoldId: 'F0',
    showNormals: true,
  }).lines.positions.length;
  assert.ok(withGizmo > baseline);
});
