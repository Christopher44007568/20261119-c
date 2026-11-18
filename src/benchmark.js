import { HeatMethodSolver } from "./heat.js";
import { createDisconnectedMesh, createPlanarMesh, createSphereMesh } from "./mesh-generators.js";
import { now } from "./factor.js";

function referenceError(mesh, result, source) {
  let absoluteSum = 0;
  let relativeSum = 0;
  let maximum = 0;
  let count = 0;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    if (!Number.isFinite(result.distances[vertex])) continue;
    const reference = mesh.referenceDistance(source, vertex);
    if (reference === null || reference < mesh.averageEdge * 0.35) continue;
    const absolute = Math.abs(result.distances[vertex] - reference);
    absoluteSum += absolute;
    relativeSum += absolute / reference;
    maximum = Math.max(maximum, absolute);
    count += 1;
  }
  return {
    meanAbsolute: absoluteSum / Math.max(1, count),
    meanRelative: relativeSum / Math.max(1, count),
    maximum,
    count
  };
}

export function runReferenceBenchmark(kind) {
  const mesh = kind === "sphere" ? createSphereMesh(28, 14) : createPlanarMesh(24, 16);
  const factorStarted = now();
  const solver = new HeatMethodSolver(mesh);
  const factorMs = now() - factorStarted;
  const result = solver.solve(mesh.suggested.source, mesh.suggested.target);
  const reference = mesh.referenceDistance(mesh.suggested.source, mesh.suggested.target);
  const computed = result.distances[mesh.suggested.target];
  const error = referenceError(mesh, result, mesh.suggested.source);
  return {
    kind,
    mesh,
    solver,
    result,
    reference,
    computed,
    targetError: Math.abs(computed - reference),
    targetRelative: Math.abs(computed - reference) / reference,
    error,
    factorMs,
    solveMs: result.timings.total,
    vertices: mesh.vertexCount
  };
}

export function runDisconnectedBenchmark() {
  const mesh = createDisconnectedMesh(12, 15);
  const solver = new HeatMethodSolver(mesh);
  const result = solver.solve(mesh.suggested.source, mesh.suggested.target);
  const targetComponent = mesh.componentOf[mesh.suggested.target];
  let filled = false;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    if (mesh.componentOf[vertex] === targetComponent) {
      filled ||= result.reachable[vertex] === 1 || Number.isFinite(result.distances[vertex]);
    }
  }
  return {
    targetReachable: result.targetReachable,
    targetDistance: result.distances[mesh.suggested.target],
    pathLength: result.path.length,
    disconnectedComponentFilled: filled,
    componentCount: mesh.components.length
  };
}

export function runBenchmarkSuite() {
  return {
    planar: runReferenceBenchmark("planar"),
    sphere: runReferenceBenchmark("sphere"),
    disconnected: runDisconnectedBenchmark()
  };
}
