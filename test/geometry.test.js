import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTopology,
  signedVolume,
  topologyIssues
} from "../src/geometry.js";
import {
  makeDentedBox,
  makeFlippedBox,
  makeOpenBox,
  makeTetrahedron
} from "../src/meshes.js";

test("正四面体的带符号体积为 1/6", () => {
  const mesh = makeTetrahedron();
  assert.ok(Math.abs(signedVolume(mesh) - 1 / 6) < 1e-12);
  assert.equal(mesh.expectedVolume, signedVolume(mesh));
  assert.deepEqual(topologyIssues(mesh), []);
});

test("带凹陷封闭箱体的带符号体积为 0.9", () => {
  const mesh = makeDentedBox();
  assert.ok(Math.abs(signedVolume(mesh) - 0.9) < 1e-12);
  assert.deepEqual(topologyIssues(mesh), []);
});

test("带符号体积满足平移不变性，反转绕向后取负", () => {
  const mesh = makeDentedBox();
  const translated = {
    ...mesh,
    vertices: mesh.vertices.map(([x, y, z]) => [x + 7, y - 3, z + 1.5])
  };
  assert.ok(Math.abs(signedVolume(translated) - 0.9) < 1e-12);

  const reversed = {
    ...mesh,
    faces: mesh.faces.map(([a, b, c]) => [a, c, b])
  };
  assert.ok(Math.abs(signedVolume(reversed) + 0.9) < 1e-12);
});

test("开放边界在求解前被识别", () => {
  const mesh = makeOpenBox();
  const topology = analyzeTopology(mesh);
  assert.ok(topology.boundaryEdges.length > 0);
  assert.ok(topologyIssues(mesh).some((issue) => issue.code === "open-boundary"));
});

test("翻转面通过边绕向不一致被识别", () => {
  const mesh = makeFlippedBox();
  const topology = analyzeTopology(mesh);
  assert.ok(topology.inconsistentEdges.length > 0);
  assert.ok(topologyIssues(mesh).some((issue) => issue.code === "inconsistent-winding"));
});
