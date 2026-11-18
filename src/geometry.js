export const TAU = Math.PI * 2;

export const vec = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  length: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize: (a) => {
    const length = Math.hypot(a[0], a[1], a[2]);
    return length > 1e-15 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
  },
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;

export function createMesh(name, vertices, faces) {
  return {
    name,
    vertices: Float64Array.from(vertices.flat ? vertices.flat() : vertices),
    faces: Uint32Array.from(faces.flat ? faces.flat() : faces),
    removed: new Uint8Array(faces.length),
  };
}

export function vertexAt(mesh, index, output = [0, 0, 0]) {
  const offset = index * 3;
  output[0] = mesh.vertices[offset];
  output[1] = mesh.vertices[offset + 1];
  output[2] = mesh.vertices[offset + 2];
  return output;
}

export function faceVertices(mesh, faceIndex) {
  const offset = faceIndex * 3;
  return [
    vertexAt(mesh, mesh.faces[offset]),
    vertexAt(mesh, mesh.faces[offset + 1]),
    vertexAt(mesh, mesh.faces[offset + 2]),
  ];
}

export function triangleNormal(a, b, c) {
  return vec.normalize(vec.cross(vec.sub(b, a), vec.sub(c, a)));
}

export function activeFaceCount(mesh) {
  let count = 0;
  for (let i = 0; i < mesh.removed.length; i += 1) {
    if (!mesh.removed[i]) count += 1;
  }
  return count;
}

export function computeBounds(mesh) {
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    center: [0, 0, 0],
    size: [0, 0, 0],
    radius: 0,
  };
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.vertices[i + axis];
      bounds.min[axis] = Math.min(bounds.min[axis], value);
      bounds.max[axis] = Math.max(bounds.max[axis], value);
    }
  }
  for (let axis = 0; axis < 3; axis += 1) {
    bounds.center[axis] = (bounds.min[axis] + bounds.max[axis]) * 0.5;
    bounds.size[axis] = bounds.max[axis] - bounds.min[axis];
  }
  bounds.radius = 0.5 * Math.hypot(...bounds.size);
  return bounds;
}

export function computeSignedVolume(mesh) {
  let volume = 0;
  for (let face = 0; face < mesh.removed.length; face += 1) {
    if (mesh.removed[face]) continue;
    const [a, b, c] = faceVertices(mesh, face);
    volume += vec.dot(a, vec.cross(b, c)) / 6;
  }
  return volume;
}

export function computeSurfaceArea(mesh) {
  let area = 0;
  for (let face = 0; face < mesh.removed.length; face += 1) {
    if (mesh.removed[face]) continue;
    const [a, b, c] = faceVertices(mesh, face);
    area += 0.5 * vec.length(vec.cross(vec.sub(b, a), vec.sub(c, a)));
  }
  return area;
}

export function computeOpenEdgeCount(mesh) {
  const counts = new Map();
  for (let face = 0; face < mesh.removed.length; face += 1) {
    if (mesh.removed[face]) continue;
    const offset = face * 3;
    const triangle = [mesh.faces[offset], mesh.faces[offset + 1], mesh.faces[offset + 2]];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangle[edge];
      const b = triangle[(edge + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let openEdges = 0;
  for (const count of counts.values()) {
    if (count === 1) openEdges += 1;
  }
  return openEdges;
}

export function meshStats(mesh) {
  return {
    faces: activeFaceCount(mesh),
    totalFaces: mesh.removed.length,
    openEdges: computeOpenEdgeCount(mesh),
    volume: computeSignedVolume(mesh),
    area: computeSurfaceArea(mesh),
    bounds: computeBounds(mesh),
  };
}

function orientOutward(vertices, faces, center = [0, 0, 0]) {
  const oriented = faces.map((face) => {
    const a = vertices[face[0]];
    const b = vertices[face[1]];
    const c = vertices[face[2]];
    const centroid = vec.scale(vec.add(vec.add(a, b), c), 1 / 3);
    const normal = vec.cross(vec.sub(b, a), vec.sub(c, a));
    return vec.dot(normal, vec.sub(centroid, center)) < 0 ? [face[0], face[2], face[1]] : face;
  });
  return oriented;
}

export function makeSphere({ rings = 14, segments = 28, radius = 1, flipped = false } = {}) {
  const vertices = [[0, radius, 0]];
  const faces = [];
  for (let ring = 1; ring < rings; ring += 1) {
    const theta = (ring * Math.PI) / rings;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let segment = 0; segment < segments; segment += 1) {
      const phi = (segment * TAU) / segments;
      vertices.push([
        radius * sinTheta * Math.cos(phi),
        radius * cosTheta,
        radius * sinTheta * Math.sin(phi),
      ]);
    }
  }
  const southPole = vertices.length;
  vertices.push([0, -radius, 0]);

  const index = (ring, segment) => 1 + (ring - 1) * segments + (segment % segments);
  for (let segment = 0; segment < segments; segment += 1) {
    const next = segment + 1;
    faces.push([0, index(1, segment), index(1, next)]);
  }
  for (let ring = 1; ring < rings - 1; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = segment + 1;
      const a = index(ring, segment);
      const b = index(ring + 1, segment);
      const c = index(ring + 1, next);
      const d = index(ring, next);
      faces.push([a, b, c], [a, c, d]);
    }
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = segment + 1;
    faces.push([
      southPole,
      index(rings - 1, segment),
      index(rings - 1, next),
    ]);
  }

  const filtered = faces.filter((face) => {
    const a = vertices[face[0]];
    const b = vertices[face[1]];
    const c = vertices[face[2]];
    return vec.length(vec.cross(vec.sub(b, a), vec.sub(c, a))) > 1e-12;
  });
  const oriented = orientOutward(vertices, filtered);
  const finalFaces = flipped
    ? oriented.map(([a, b, c]) => [a, c, b])
    : oriented;
  const mesh = createMesh(flipped ? "inward sphere" : "closed sphere", vertices, finalFaces);
  mesh.kind = flipped ? "sphere-flipped" : "sphere";
  mesh.analytic = { type: "sphere", center: [0, 0, 0], radius };
  return mesh;
}

export function makeOpenSheet({ size = 2.4, segments = 18 } = {}) {
  const vertices = [];
  const faces = [];
  const half = size * 0.5;
  for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
    const z = -half + (size * zIndex) / segments;
    for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
      const x = -half + (size * xIndex) / segments;
      const y = 0.075 * Math.cos((x * Math.PI) / size) * Math.cos((z * Math.PI) / size);
      vertices.push([x, y, z]);
    }
  }
  const index = (xIndex, zIndex) => zIndex * (segments + 1) + xIndex;
  for (let zIndex = 0; zIndex < segments; zIndex += 1) {
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const a = index(xIndex, zIndex);
      const b = index(xIndex + 1, zIndex);
      const c = index(xIndex + 1, zIndex + 1);
      const d = index(xIndex, zIndex + 1);
      faces.push([a, c, b], [a, d, c]);
    }
  }
  const mesh = createMesh("open sheet", vertices, faces);
  mesh.kind = "sheet";
  return mesh;
}

export function flipMeshOrientation(mesh) {
  for (let face = 0; face < mesh.removed.length; face += 1) {
    const offset = face * 3;
    const temp = mesh.faces[offset + 1];
    mesh.faces[offset + 1] = mesh.faces[offset + 2];
    mesh.faces[offset + 2] = temp;
  }
  return mesh;
}
