export const EPSILON = 1e-12;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const distanceSquared = (a, b) => {
  const d = sub(a, b);
  return dot(d, d);
};

export function cloneVertices(vertices) {
  return vertices.map((vertex) => vertex.slice());
}

export function triangleNormal(vertices, face) {
  const [a, b, c] = face;
  return cross(sub(vertices[b], vertices[a]), sub(vertices[c], vertices[a]));
}

export function triangleArea(vertices, face) {
  return 0.5 * length(triangleNormal(vertices, face));
}

export function signedVolume(mesh, vertices = mesh.vertices) {
  let sixVolume = 0;
  for (const [a, b, c] of mesh.faces) {
    sixVolume += dot(vertices[a], cross(vertices[b], vertices[c]));
  }
  return sixVolume / 6;
}

export function boundingDiagonal(vertices) {
  if (vertices.length === 0) return 0;
  const min = vertices[0].slice();
  const max = vertices[0].slice();
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  return length(sub(max, min));
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function analyzeTopology(mesh, options = {}) {
  const areaTolerance = options.areaTolerance ?? EPSILON;
  const edges = new Map();
  const degenerateFaces = [];

  mesh.faces.forEach((face, faceIndex) => {
    const [a, b, c] = face;
    if (a === b || b === c || c === a) {
      degenerateFaces.push({ face: faceIndex, reason: "repeated-vertex" });
    } else if (triangleArea(mesh.vertices, face) <= areaTolerance) {
      degenerateFaces.push({ face: faceIndex, reason: "zero-area" });
    }

    for (const [from, to] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(from, to);
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ from, to, face: faceIndex });
    }
  });

  const boundaryEdges = [];
  const nonManifoldEdges = [];
  const inconsistentEdges = [];

  for (const [key, records] of edges) {
    const [a, b] = key.split(":").map(Number);
    if (records.length === 1) {
      boundaryEdges.push({ a, b, faces: [records[0].face] });
    } else if (records.length > 2) {
      nonManifoldEdges.push({ a, b, faces: records.map((record) => record.face) });
    } else if (records[0].from === records[1].from) {
      inconsistentEdges.push({
        a,
        b,
        faces: records.map((record) => record.face)
      });
    }
  }

  return { boundaryEdges, nonManifoldEdges, inconsistentEdges, degenerateFaces };
}

export function topologyIssues(mesh) {
  const topology = analyzeTopology(mesh);
  const issues = [];

  if (topology.boundaryEdges.length > 0) {
    issues.push({
      code: "open-boundary",
      message: `检测到 ${topology.boundaryEdges.length} 条开放边界边，网格不封闭。`,
      details: topology
    });
  }
  if (topology.nonManifoldEdges.length > 0) {
    issues.push({
      code: "non-manifold",
      message: `检测到 ${topology.nonManifoldEdges.length} 条非流形边。`,
      details: topology
    });
  }
  if (topology.degenerateFaces.length > 0) {
    issues.push({
      code: "degenerate-face",
      message: `检测到 ${topology.degenerateFaces.length} 个退化面。`,
      details: topology
    });
  }
  if (topology.inconsistentEdges.length > 0) {
    issues.push({
      code: "inconsistent-winding",
      message: `检测到 ${topology.inconsistentEdges.length} 条边两侧面片绕向相反，存在翻转面。`,
      details: topology
    });
  }

  return issues;
}

export function detectFlippedFaces(mesh, referenceVertices, currentVertices) {
  const flipped = [];
  mesh.faces.forEach((face, faceIndex) => {
    const reference = triangleNormal(referenceVertices, face);
    const current = triangleNormal(currentVertices, face);
    const referenceLength = length(reference);
    const currentLength = length(current);
    const denominator = referenceLength * currentLength;
    const alignment = denominator > EPSILON ? dot(reference, current) / denominator : 0;

    if (currentLength <= EPSILON || alignment <= 0) {
      flipped.push({
        face: faceIndex,
        alignment,
        reason: currentLength <= EPSILON ? "collapsed" : "inverted"
      });
    }
  });
  return flipped;
}

export function reconcileControls(controls, vertexCount, tolerance = 1e-9) {
  const issues = [];
  const byVertex = new Map();

  controls.forEach((control, controlIndex) => {
    const vertex = Number(control.vertex);
    const target = control.target;
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount) {
      issues.push({
        code: "invalid-control",
        controlIndex,
        message: `控制点 #${controlIndex + 1} 引用了无效顶点 ${control.vertex}。`
      });
      return;
    }
    if (!Array.isArray(target) || target.length !== 3 || !target.every(Number.isFinite)) {
      issues.push({
        code: "invalid-control",
        controlIndex,
        message: `控制点 #${controlIndex + 1} 的目标位置无效。`
      });
      return;
    }

    const previous = byVertex.get(vertex);
    if (!previous) {
      byVertex.set(vertex, { vertex, target: target.slice(), controlIndices: [controlIndex] });
      return;
    }

    const delta = sub(target, previous.target);
    const separation = length(delta);
    previous.controlIndices.push(controlIndex);
    if (separation > tolerance) {
      issues.push({
        code: "conflicting-controls",
        vertex,
        controlIndices: previous.controlIndices.slice(),
        separation,
        message:
          `顶点 ${vertex} 被指定到两个不同位置，间距 ${separation.toExponential(3)}；` +
          "控制点互相矛盾。"
      });
    }
  });

  return {
    ok: issues.length === 0,
    issues,
    byVertex,
    controls: [...byVertex.values()]
  };
}

function smoothFalloff(distance, radius) {
  if (radius <= EPSILON || distance >= radius) return 0;
  const t = 1 - distance / radius;
  return t * t * (3 - 2 * t);
}

export function applyLocalControls(mesh, baseVertices, controls, radius) {
  const reconciled = reconcileControls(controls, baseVertices.length);
  if (!reconciled.ok) {
    return { positions: cloneVertices(baseVertices), weights: new Float64Array(baseVertices.length), reconciled };
  }

  const positions = cloneVertices(baseVertices);
  const weights = new Float64Array(baseVertices.length);
  const activeControls = reconciled.controls;

  for (let vertexIndex = 0; vertexIndex < baseVertices.length; vertexIndex += 1) {
    const direct = reconciled.byVertex.get(vertexIndex);
    if (direct) {
      positions[vertexIndex] = direct.target.slice();
      weights[vertexIndex] = 1;
      continue;
    }

    const source = baseVertices[vertexIndex];
    const accumulated = [0, 0, 0];
    for (const control of activeControls) {
      const falloff = smoothFalloff(
        Math.sqrt(distanceSquared(source, baseVertices[control.vertex])),
        radius
      );
      if (falloff === 0) continue;
      weights[vertexIndex] = Math.max(weights[vertexIndex], falloff);
      const displacement = sub(control.target, baseVertices[control.vertex]);
      accumulated[0] += falloff * displacement[0];
      accumulated[1] += falloff * displacement[1];
      accumulated[2] += falloff * displacement[2];
    }
    positions[vertexIndex] = add(source, accumulated);
  }

  return { positions, weights, reconciled };
}
