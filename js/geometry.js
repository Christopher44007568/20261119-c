import {
  cross,
  dot,
  mul,
  normalize,
  sub,
  triangleBounds,
  triangleCentroid,
} from "./math.js";

export const LOBE_GAP = 0.055;
export const LOBE_WIDTH = 1.0;
export const LOBE_HEIGHT = 1.9;
export const HIGH_RESOLUTION = { u: 30, v: 36 };
export const LOW_RESOLUTION = { u: 7, v: 9 };

export const HIGH_HOLES = [
  { u: 0.22, v: 0.52, radius: 0.031 },
  { u: 0.82, v: 0.27, radius: 0.022 },
];

function gaussian(u, v, cu, cv, radius, amplitude) {
  const du = u - cu;
  const dv = v - cv;
  return amplitude * Math.exp(-(du * du + dv * dv) / (radius * radius));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function baseHeight(u, v) {
  const bulge = 0.19 * (1 - 0.32 * u * u);
  const bend = 0.045 * Math.cos((v - 0.5) * Math.PI * 1.15);
  return bulge + bend;
}

export function detailOffset(u, v) {
  const slatMask = 0.45 + 0.55 * u;
  const grooveA =
    -0.072 *
    Math.exp(-Math.pow((v - 0.29) / 0.036, 2)) *
    (0.35 + 0.65 * u);
  const grooveB =
    -0.054 *
    Math.exp(-Math.pow((v - 0.71) / 0.030, 2)) *
    (0.35 + 0.65 * u);
  const spineCenter = 0.52 + 0.055 * Math.sin(v * 8.5);
  const spine =
    0.057 *
    Math.exp(-Math.pow((u - spineCenter) / 0.085, 2)) *
    (0.35 + 0.65 * v);
  const rivets =
    gaussian(u, v, 0.16, 0.16, 0.020, 0.060) +
    gaussian(u, v, 0.16, 0.84, 0.020, 0.060) +
    gaussian(u, v, 0.84, 0.19, 0.016, 0.046) +
    gaussian(u, v, 0.84, 0.80, 0.018, 0.052);
  const boss = gaussian(u, v, 0.52, 0.52, 0.050, 0.145);
  const rim =
    0.025 *
    Math.exp(-Math.pow((u - 0.94) / 0.035, 2)) *
    (0.5 + 0.5 * Math.cos(v * Math.PI * 3));
  const grain =
    0.0065 * Math.sin(u * 22 + v * 5.5) * Math.sin(v * 17 - u * 4) +
    0.003 * Math.sin(u * 54 + v * 31);

  return grooveA + grooveB + spine * slatMask + rivets + boss + rim + grain;
}

export function heightAt(u, v, detailed = true) {
  const cu = clamp01(u);
  const cv = clamp01(v);
  return baseHeight(cu, cv) + (detailed ? detailOffset(cu, cv) : 0);
}

export function surfaceNormal(u, v, sign, detailed = true) {
  const step = 0.0007;
  const u0 = clamp01(u - step);
  const u1 = clamp01(u + step);
  const v0 = clamp01(v - step);
  const v1 = clamp01(v + step);
  const dzdu = (heightAt(u1, v, detailed) - heightAt(u0, v, detailed)) / (u1 - u0);
  const dzdv = (heightAt(u, v1, detailed) - heightAt(u, v0, detailed)) / (v1 - v0);
  const zx = (sign * dzdu) / LOBE_WIDTH;
  const zy = dzdv / LOBE_HEIGHT;
  return normalize([-zx, -zy, 1]);
}

export function lobePosition(sign, u, v, detailed = true) {
  return [
    sign * (LOBE_GAP + LOBE_WIDTH * u),
    (v - 0.5) * LOBE_HEIGHT,
    heightAt(u, v, detailed),
  ];
}

export function islandUv(sign, u, v) {
  return sign < 0
    ? [0.06 + 0.40 * u, 0.06 + 0.88 * v]
    : [0.94 - 0.40 * u, 0.06 + 0.88 * v];
}

export function lobeTbn(sign, u, v, detailed = true) {
  const step = 0.0007;
  const du = (heightAt(clamp01(u + step), v, detailed) - heightAt(clamp01(u - step), v, detailed)) /
    (clamp01(u + step) - clamp01(u - step));
  const dv = (heightAt(u, clamp01(v + step), detailed) - heightAt(u, clamp01(v - step), detailed)) /
    (clamp01(v + step) - clamp01(v - step));
  const dPdu = [sign * LOBE_WIDTH, 0, du];
  const dPdv = [0, LOBE_HEIGHT, dv];
  const dUdu = sign < 0 ? 0.40 : -0.40;
  const dVdv = 0.88;
  const tangent = normalize(mul(dPdu, 1 / dUdu), [1, 0, 0]);
  const bitangentUv = normalize(mul(dPdv, 1 / dVdv), [0, 1, 0]);
  const normal = surfaceNormal(u, v, sign, detailed);
  const handedness = dot(cross(tangent, bitangentUv), normal) < 0 ? -1 : 1;
  const bitangent = normalize(mul(cross(normal, tangent), handedness));
  return { tangent, bitangent, normal, handedness };
}

function triangleFromVertices(vertices, ia, ib, ic, mesh) {
  const a = vertices.positions.slice(ia * 3, ia * 3 + 3);
  const b = vertices.positions.slice(ib * 3, ib * 3 + 3);
  const c = vertices.positions.slice(ic * 3, ic * 3 + 3);
  const na = vertices.normals.slice(ia * 3, ia * 3 + 3);
  const nb = vertices.normals.slice(ib * 3, ib * 3 + 3);
  const nc = vertices.normals.slice(ic * 3, ic * 3 + 3);
  const faceNormal = normalize(cross(sub(b, a), sub(c, a)));
  const triangle = {
    a,
    b,
    c,
    na,
    nb,
    nc,
    faceNormal,
    mesh,
    bounds: null,
    centroid: null,
  };
  triangle.bounds = triangleBounds(triangle);
  triangle.centroid = triangleCentroid(triangle);
  return triangle;
}

function isHoleCenter(u, v) {
  return HIGH_HOLES.some((hole) => {
    const du = u - hole.u;
    const dv = v - hole.v;
    return du * du + dv * dv < hole.radius * hole.radius;
  });
}

function createLobeMesh({ sign, detailed, resolution, holes = [] }) {
  const columns = resolution.u + 1;
  const rows = resolution.v + 1;
  const vertexCount = columns * rows;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 3);
  const bitangentSigns = new Float32Array(vertexCount);
  const uvs = new Float32Array(vertexCount * 2);
  const params = new Float32Array(vertexCount * 2);
  const indices = [];
  const vertices = { positions, normals };

  for (let row = 0; row < rows; row += 1) {
    const v = row / resolution.v;
    for (let column = 0; column < columns; column += 1) {
      const u = column / resolution.u;
      const index = row * columns + column;
      const position = lobePosition(sign, u, v, detailed);
      const tbn = lobeTbn(sign, u, v, detailed);
      const uv = islandUv(sign, u, v);

      positions[index * 3] = position[0];
      positions[index * 3 + 1] = position[1];
      positions[index * 3 + 2] = position[2];
      normals[index * 3] = tbn.normal[0];
      normals[index * 3 + 1] = tbn.normal[1];
      normals[index * 3 + 2] = tbn.normal[2];
      tangents[index * 3] = tbn.tangent[0];
      tangents[index * 3 + 1] = tbn.tangent[1];
      tangents[index * 3 + 2] = tbn.tangent[2];
      bitangentSigns[index] = tbn.handedness;
      uvs[index * 2] = uv[0];
      uvs[index * 2 + 1] = uv[1];
      params[index * 2] = u;
      params[index * 2 + 1] = v;
    }
  }

  for (let row = 0; row < resolution.v; row += 1) {
    const v = (row + 0.5) / resolution.v;
    for (let column = 0; column < resolution.u; column += 1) {
      const u = (column + 0.5) / resolution.u;
      if (holes.length > 0 && isHoleCenter(u, v)) continue;
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  for (let index = 0; index < indices.length; index += 3) {
    const ia = indices[index];
    const ib = indices[index + 1];
    const ic = indices[index + 2];
    const pa = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
    const pb = [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]];
    const pc = [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]];
    const face = cross(sub(pb, pa), sub(pc, pa));
    const averageNormal = [
      normals[ia * 3] + normals[ib * 3] + normals[ic * 3],
      normals[ia * 3 + 1] + normals[ib * 3 + 1] + normals[ic * 3 + 1],
      normals[ia * 3 + 2] + normals[ib * 3 + 2] + normals[ic * 3 + 2],
    ];
    if (dot(face, averageNormal) < 0) {
      indices[index + 1] = ic;
      indices[index + 2] = ib;
    }
  }

  const mesh = {
    sign,
    detailed,
    resolution,
    columns,
    rows,
    positions,
    normals,
    tangents,
    bitangentSigns,
    uvs,
    params,
    indices,
    triangles: [],
  };

  mesh.triangles = [];
  for (let index = 0; index < indices.length; index += 3) {
    mesh.triangles.push(
      triangleFromVertices(vertices, indices[index], indices[index + 1], indices[index + 2], mesh),
    );
  }

  return mesh;
}

function boundaryEdges(mesh) {
  const edges = [];
  const lastColumn = mesh.columns - 1;
  const lastRow = mesh.rows - 1;

  for (let column = 0; column < mesh.columns - 1; column += 1) {
    edges.push([column, column + 1]);
    edges.push([lastRow * mesh.columns + column, lastRow * mesh.columns + column + 1]);
  }
  for (let row = 0; row < mesh.rows - 1; row += 1) {
    edges.push([row * mesh.columns, (row + 1) * mesh.columns]);
    edges.push([row * mesh.columns + lastColumn, (row + 1) * mesh.columns + lastColumn]);
  }

  return edges;
}

export function createHighLowModel() {
  const highLeft = createLobeMesh({
    sign: -1,
    detailed: true,
    resolution: HIGH_RESOLUTION,
    holes: HIGH_HOLES,
  });
  const highRight = createLobeMesh({
    sign: 1,
    detailed: true,
    resolution: HIGH_RESOLUTION,
    holes: HIGH_HOLES,
  });
  const lowLeft = createLobeMesh({
    sign: -1,
    detailed: false,
    resolution: LOW_RESOLUTION,
  });
  const lowRight = createLobeMesh({
    sign: 1,
    detailed: false,
    resolution: LOW_RESOLUTION,
  });

  const highMeshes = [highLeft, highRight];
  const lowMeshes = [lowLeft, lowRight];
  const highTriangles = highMeshes.flatMap((mesh) => mesh.triangles);
  const seamEdges = [
    ...boundaryEdges(lowLeft).map(([a, b]) => ({ mesh: lowLeft, a, b, island: "L" })),
    ...boundaryEdges(lowRight).map(([a, b]) => ({ mesh: lowRight, a, b, island: "R" })),
  ];

  return {
    highMeshes,
    lowMeshes,
    highTriangles,
    seamEdges,
    highTriangleCount: highTriangles.length,
    lowTriangleCount: lowMeshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0),
  };
}

export function vertexPosition(mesh, index) {
  return [
    mesh.positions[index * 3],
    mesh.positions[index * 3 + 1],
    mesh.positions[index * 3 + 2],
  ];
}

export function vertexNormal(mesh, index) {
  return [
    mesh.normals[index * 3],
    mesh.normals[index * 3 + 1],
    mesh.normals[index * 3 + 2],
  ];
}

export function vertexTangents(mesh, index) {
  return {
    tangent: [
      mesh.tangents[index * 3],
      mesh.tangents[index * 3 + 1],
      mesh.tangents[index * 3 + 2],
    ],
    bitangentSign: mesh.bitangentSigns[index],
  };
}

export function vertexUv(mesh, index) {
  return [mesh.uvs[index * 2], mesh.uvs[index * 2 + 1]];
}

export function vertexParam(mesh, index) {
  return [mesh.params[index * 2], mesh.params[index * 2 + 1]];
}
