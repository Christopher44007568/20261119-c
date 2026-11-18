import test from "node:test";
import assert from "node:assert/strict";
import { HeatMethodSolver } from "../src/heat.js";
import { createDisconnectedMesh, createPlanarMesh, createSphereMesh } from "../src/mesh-generators.js";
import { runDisconnectedBenchmark, runReferenceBenchmark } from "../src/benchmark.js";

test("planar distances follow the analytic straight line", () => {
  const benchmark = runReferenceBenchmark("planar");
  assert.ok(benchmark.targetRelative < 0.05, `target error ${benchmark.targetRelative}`);
  assert.ok(benchmark.error.meanRelative < 0.04, `mean error ${benchmark.error.meanRelative}`);
  assert.ok(benchmark.result.path.length > 2);
});

test("sphere distances follow the great-circle reference", () => {
  const benchmark = runReferenceBenchmark("sphere");
  assert.ok(benchmark.targetRelative < 0.05, `target error ${benchmark.targetRelative}`);
  assert.ok(benchmark.error.meanRelative < 0.04, `mean error ${benchmark.error.meanRelative}`);
});

test("factored systems are reused when the source changes", () => {
  const mesh = createSphereMesh(20, 10);
  const solver = new HeatMethodSolver(mesh);
  const builds = solver.factorBuilds;
  solver.solve(mesh.suggested.source);
  const newSource = mesh.suggested.target;
  const second = solver.solve(newSource);
  assert.equal(solver.factorBuilds, builds);
  assert.equal(solver.reuseCount, 1);
  assert.equal(second.distances[newSource], 0);
});

test("disconnected components remain unreachable", () => {
  const check = runDisconnectedBenchmark();
  assert.equal(check.componentCount, 2);
  assert.equal(check.targetReachable, false);
  assert.equal(check.targetDistance, Infinity);
  assert.equal(check.pathLength, 0);
  assert.equal(check.disconnectedComponentFilled, false);
});

test("path tracing starts at target and ends at source", () => {
  const mesh = createPlanarMesh(20, 14);
  const solver = new HeatMethodSolver(mesh);
  const result = solver.solve(mesh.suggested.source, mesh.suggested.target);
  const first = result.path[0];
  const last = result.path.at(-1);
  const target = mesh.point(mesh.suggested.target);
  const source = mesh.point(mesh.suggested.source);
  assert.ok(Math.hypot(first[0] - target[0], first[1] - target[1], first[2] - target[2]) < 1e-9);
  assert.ok(Math.hypot(last[0] - source[0], last[1] - source[1], last[2] - source[2]) < 1e-9);
  assert.ok(result.path.length < 600);
});

test("a fresh solver invalidates prior factorization state", () => {
  const firstMesh = createPlanarMesh(14, 10);
  const first = new HeatMethodSolver(firstMesh);
  const secondMesh = createPlanarMesh(18, 12);
  const second = new HeatMethodSolver(secondMesh);
  assert.notEqual(firstMesh.vertexCount, secondMesh.vertexCount);
  assert.equal(second.solveCount, 0);
  assert.equal(second.reuseCount, 0);
});
