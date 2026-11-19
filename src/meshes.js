import { signedVolume } from "./geometry.js";

function centroid(vertices) {
  const sum = [0, 0, 0];
  for (const vertex of vertices) {
    sum[0] += vertex[0];
    sum[1] += vertex[1];
    sum[2] += vertex[2];
  }
  return sum.map((value) => value / vertices.length);
}

export function makeTetrahedron() {
  const raw = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  const center = centroid(raw);
  const vertices = raw.map((vertex) => vertex.map((value, axis) => value - center[axis]));
  const mesh = {
    name: "正四面体",
    description: "解析体积为 1/6 的封闭正四面体，用于体积公式基准测试。",
    vertices,
    faces: [
      [1, 2, 3],
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2]
    ]
  };
  return { ...mesh, expectedVolume: signedVolume(mesh) };
}

export function makeDentedBox() {
  const mesh = {
    name: "凹陷封闭箱体",
    description: "顶面中心向内的解析凹陷，带符号体积应为 1 - 1/10 = 0.9。",
    vertices: [
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [0, 0, 0.2]
    ],
    faces: [
      [0, 2, 1],
      [0, 3, 2],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
      [8, 4, 5],
      [8, 5, 6],
      [8, 6, 7],
      [8, 7, 4]
    ]
  };
  return { ...mesh, expectedVolume: 0.9, dentVertex: 8 };
}

function cloneMesh(mesh) {
  return {
    ...mesh,
    vertices: mesh.vertices.map((vertex) => vertex.slice()),
    faces: mesh.faces.map((face) => face.slice())
  };
}

export function makeOpenBox() {
  const mesh = cloneMesh(makeDentedBox());
  mesh.name = "开放边界诊断";
  mesh.description = "移除一个顶面三角形，用于验证求解前开放边界检查。";
  mesh.faces.pop();
  mesh.expectedVolume = null;
  mesh.invalidKind = "open";
  return mesh;
}

export function makeFlippedBox() {
  const mesh = cloneMesh(makeDentedBox());
  mesh.name = "翻转面诊断";
  mesh.description = "将首面绕向反转，用于验证求解前翻转面检查。";
  [mesh.faces[0][1], mesh.faces[0][2]] = [mesh.faces[0][2], mesh.faces[0][1]];
  mesh.expectedVolume = null;
  mesh.invalidKind = "flipped";
  return mesh;
}

export function makeMeshes() {
  return [makeTetrahedron(), makeDentedBox(), makeOpenBox(), makeFlippedBox()];
}
