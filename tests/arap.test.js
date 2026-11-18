import assert from "node:assert/strict";
import test from "node:test";
import {
  createDisconnectedMesh,
  createPerforatedMesh,
  createStripMesh,
  meshToOBJ,
} from "../src/mesh.js";
import { runARAP, solveLaplacian } from "../src/arap.js";

function assertAnchors(mesh, positions, target) {
  for (const index of mesh.fixed) {
    assert.ok(Math.abs(positions[index * 2] - mesh.rest[index * 2]) < 1e-10);
    assert.ok(Math.abs(positions[index * 2 + 1] - mesh.rest[index * 2 + 1]) < 1e-10);
  }
  if (target) {
    assert.ok(Math.abs(positions[target.index * 2] - target.x) < 1e-10);
    assert.ok(Math.abs(positions[target.index * 2 + 1] - target.y) < 1e-10);
  }
}

function triangleAreas(mesh, positions) {
  return mesh.triangles.map(([a, b, c]) => {
    const ax = positions[a * 2];
    const ay = positions[a * 2 + 1];
    const bx = positions[b * 2];
    const by = positions[b * 2 + 1];
    const cx = positions[c * 2];
    const cy = positions[c * 2 + 1];
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  });
}

test("长条弯折：ARAP 迭代优于 Laplacian 且不是线性拉动", () => {
  const mesh = createStripMesh();
  const target = { index: mesh.control, x: 2.2, y: 2.8 };
  const result = runARAP(mesh, {
    target,
    maxIterations: 24,
    energyTolerance: 1e-9,
    rigidTolerance: 1e-7,
  });
  const laplacian = solveLaplacian(mesh, { target });

  assertAnchors(mesh, result.positions, target);
  assert.equal(result.anchorDrift, 0);
  assert.ok(Number.isFinite(result.energy));
  assert.ok(result.history.length >= 2);
  assert.ok(result.energy < result.history[0].energy);
  assert.ok(result.energy < laplacian.energy * 0.2);
  assert.ok(result.rigidRms < laplacian.rigidRms * 0.3);
  assert.ok(result.stopLabel.length > 0);

  let maximumDifference = 0;
  for (let index = 0; index < result.positions.length; index += 1) {
    maximumDifference = Math.max(
      maximumDifference,
      Math.abs(result.positions[index] - laplacian.positions[index]),
    );
  }
  assert.ok(maximumDifference > 0.1, "ARAP 结果不应只是拉普拉斯线性解");
});

test("带孔薄片：孔洞三角拓扑保持、无翻转且固定点不漂移", () => {
  const mesh = createPerforatedMesh();
  const target = { index: mesh.control, x: 2.4, y: 2.3 };
  const restAreas = triangleAreas(mesh, mesh.rest);
  const result = runARAP(mesh, { target, maxIterations: 28 });
  const areas = triangleAreas(mesh, result.positions);

  assert.equal(mesh.triangles.length, 396);
  assert.equal(result.componentReport.components.length, 1);
  assert.equal(result.componentReport.skipped.length, 0);
  assertAnchors(mesh, result.positions, target);
  assert.equal(areas.length, restAreas.length);
  for (let index = 0; index < areas.length; index += 1) {
    assert.ok(Number.isFinite(areas[index]));
    assert.equal(Math.sign(areas[index]), Math.sign(restAreas[index]));
  }
  assert.ok(result.energy < result.history[0].energy);
});

test("不连通网格：缺少约束的分量被报告并保持原位", () => {
  const mesh = createDisconnectedMesh();
  const target = { index: mesh.control, x: 1.2, y: 2.1 };
  const result = runARAP(mesh, { target, maxIterations: 18 });

  assert.equal(result.componentReport.components.length, 2);
  assert.equal(result.componentReport.skipped.length, 1);
  const missing = result.componentReport.skipped[0];
  assert.equal(missing.size, 25);
  for (const index of missing.vertices) {
    assert.equal(result.positions[index * 2], mesh.rest[index * 2]);
    assert.equal(result.positions[index * 2 + 1], mesh.rest[index * 2 + 1]);
  }
  assertAnchors(mesh, result.positions, target);
  assert.equal(result.componentReport.constrainedCount, 1);
});

test("全部连通分量缺少约束时停止并报告", () => {
  const mesh = createStripMesh();
  mesh.fixed.clear();
  const result = runARAP(mesh, { target: null, maxIterations: 10 });

  assert.equal(result.iteration, 0);
  assert.equal(result.stopReason, "missing_constraints");
  assert.equal(result.componentReport.skipped.length, 1);
  assert.deepEqual([...result.positions], [...mesh.rest]);
});

test("收敛记录保留最大迭代停止原因与硬约束", () => {
  const mesh = createStripMesh();
  const target = { index: mesh.control, x: 1.8, y: 2.2 };
  const result = runARAP(mesh, {
    target,
    maxIterations: 6,
    energyTolerance: 1e-20,
    rigidTolerance: 1e-20,
  });

  assert.equal(result.iteration, 6);
  assert.equal(result.stopReason, "max_iterations");
  assert.equal(result.history.length, 6);
  assert.equal(result.done, true);
  assert.equal(result.anchorDrift, 0);
  assertAnchors(mesh, result.positions, target);
});

test("Laplacian 参考解与 OBJ 导出包含约束元数据", () => {
  const mesh = createStripMesh();
  const target = { index: mesh.control, x: 2.7, y: 1.4 };
  const laplacian = solveLaplacian(mesh, { target });
  const arap = runARAP(mesh, { target, maxIterations: 15 });
  const obj = meshToOBJ(mesh, arap.positions, {
    stopReason: arap.stopLabel,
    iterations: arap.iteration,
    energy: arap.energy,
    rigidResidual: arap.rigidRms,
  });

  assertAnchors(mesh, laplacian.positions, target);
  assert.equal(laplacian.anchorDrift, 0);
  assert.match(obj, /^# convergence:/m);
  assert.match(obj, /^# pinned_vertices:/m);
  assert.equal((obj.match(/^v /gm) || []).length, mesh.positions.length / 2);
  assert.equal((obj.match(/^f /gm) || []).length, mesh.triangles.length);
});
