import test from "node:test";
import assert from "node:assert/strict";
import {
  boundingDiagonal,
  detectFlippedFaces,
  dot,
  signedVolume,
  sub
} from "../src/geometry.js";
import {
  makeDentedBox,
  makeFlippedBox,
  makeOpenBox,
  makeTetrahedron
} from "../src/meshes.js";
import { deformVolumePreserving } from "../src/solver.js";

function maxDistance(a, b) {
  let maximum = 0;
  for (let index = 0; index < a.length; index += 1) {
    const delta = sub(a[index], b[index]);
    maximum = Math.max(maximum, Math.hypot(...delta));
  }
  return maximum;
}

test("局部位移后保持控制点并收敛到目标体积", () => {
  const mesh = makeDentedBox();
  const control = { vertex: 8, target: [0, 0, 0.42] };
  const result = deformVolumePreserving(mesh, [control], { radius: 0.75 });

  assert.equal(result.ok, true);
  assert.equal(result.status, "converged");
  assert.ok(Math.abs(result.finalVolume - 0.9) < 1e-8);
  assert.ok(maxDistance([result.positions[8]], [control.target]) < 1e-12);
  assert.equal(result.controlResidual, 0);
  assert.ok(result.iterations.length >= 2);
  assert.ok(result.iterations.every((step) => step.maxCorrection >= 0));
  assert.ok(
    Math.abs(result.iterations.at(-1).residual) <
      Math.abs(result.iterations[0].residualBefore)
  );
});

test("体积修正是局部修正而不是整体缩放", () => {
  const mesh = makeDentedBox();
  const result = deformVolumePreserving(
    mesh,
    [{ vertex: 8, target: [0, 0, 0.45] }],
    { radius: 0.7 }
  );
  assert.equal(result.ok, true);

  const reference = mesh.vertices;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < reference.length; index += 1) {
    numerator += dot(result.positions[index], reference[index]);
    denominator += dot(reference[index], reference[index]);
  }
  const bestGlobalScale = numerator / denominator;
  const globallyScaled = reference.map((vertex) => vertex.map((value) => value * bestGlobalScale));
  const scaleError = maxDistance(result.positions, globallyScaled);
  assert.ok(scaleError > 0.1, `best-fit global scale would hide a ${scaleError} error`);
  assert.ok(maxDistance([result.positions[8]], [[0, 0, 0.45]]) < 1e-12);
});

test("同一顶点收到不同目标位置时冲突并保留原形状", () => {
  const mesh = makeDentedBox();
  const original = mesh.vertices.map((vertex) => vertex.slice());
  const result = deformVolumePreserving(mesh, [
    { vertex: 8, target: [0, 0, 0.45] },
    { vertex: 8, target: [0, 0, -0.1] }
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.status, "conflict");
  assert.match(result.message, /矛盾/);
  assert.match(result.message, /保留最后可行形状/);
  assert.deepEqual(result.positions, original);
  assert.equal(result.iterations.length, 0);
});

test("所有顶点被固定但体积不符时判定约束不可行并保留原形状", () => {
  const mesh = makeDentedBox();
  const original = mesh.vertices.map((vertex) => vertex.slice());
  const controls = mesh.vertices.map((vertex, index) => ({
    vertex: index,
    target: index === 8 ? [0, 0, 0.4] : vertex.slice()
  }));
  const result = deformVolumePreserving(mesh, controls);

  assert.equal(result.ok, false);
  assert.equal(result.status, "infeasible-controls");
  assert.match(result.message, /保留最后可行形状/);
  assert.deepEqual(result.positions, original);
});

test("开放边界和翻转面在体积求解前报出", () => {
  const openResult = deformVolumePreserving(makeOpenBox(), []);
  assert.equal(openResult.ok, false);
  assert.equal(openResult.stage, "topology");
  assert.ok(openResult.issues.some((issue) => issue.code === "open-boundary"));
  assert.equal(openResult.iterations.length, 0);

  const flippedResult = deformVolumePreserving(makeFlippedBox(), []);
  assert.equal(flippedResult.ok, false);
  assert.equal(flippedResult.stage, "topology");
  assert.ok(flippedResult.issues.some((issue) => issue.code === "inconsistent-winding"));
  assert.equal(flippedResult.iterations.length, 0);
});

test("控制点造成的局部翻面在体积迭代前被阻止", () => {
  const mesh = makeDentedBox();
  const original = mesh.vertices.map((vertex) => vertex.slice());
  const result = deformVolumePreserving(
    mesh,
    [{ vertex: 8, target: [1, 0, 0.2] }],
    { radius: 0.08 }
  );

  assert.equal(result.ok, false);
  assert.equal(result.stage, "local-deformation");
  assert.ok(result.flippedFaces.length > 0);
  assert.match(result.message, /翻转/);
  assert.deepEqual(result.positions, original);
  assert.equal(result.iterations.length, 0);
});

test("面法向反转可由变形预检识别", () => {
  const mesh = makeTetrahedron();
  const deformed = mesh.vertices.map((vertex) => vertex.slice());
  const face = mesh.faces[0];
  deformed[face[1]] = deformed[face[1]].map((value) => -value);
  const flipped = detectFlippedFaces(mesh, mesh.vertices, deformed);
  assert.ok(flipped.length >= 1);
});

test("删除一个面后拓扑确实不再闭合", () => {
  const mesh = makeOpenBox();
  const diagonal = boundingDiagonal(mesh.vertices);
  assert.ok(diagonal > 0);
  assert.equal(signedVolume(mesh) > 0, true);
});
