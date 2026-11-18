import {
  EPS,
  buildBoundaryLoops,
  buildTopology,
  faceComponents,
  faceNormal,
  findDuplicateGroups,
} from './meshCore.js';

function orientComponents(mesh, topology) {
  const adjacency = Array.from({ length: mesh.faces.length }, () => []);
  topology.manifoldEdges.forEach((edge) => {
    const [faceA, faceB] = edge.faces;
    const [directionA, directionB] = edge.directions;
    const sameDirection =
      directionA[0] === directionB[0] && directionA[1] === directionB[1];
    adjacency[faceA].push({ face: faceB, flip: sameDirection ? 1 : 0 });
    adjacency[faceB].push({ face: faceA, flip: sameDirection ? 1 : 0 });
  });

  const boundaryFaces = new Set();
  topology.boundaryEdges.forEach((edge) => boundaryFaces.add(edge.faces[0]));

  const parity = new Int8Array(mesh.faces.length).fill(-1);
  const groups = [];
  for (let start = 0; start < mesh.faces.length; start += 1) {
    if (parity[start] !== -1) continue;
    const queue = [start];
    const faces = [];
    parity[start] = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const face = queue[cursor];
      faces.push(face);
      adjacency[face].forEach((neighbor) => {
        if (parity[neighbor.face] !== -1) return;
        parity[neighbor.face] = parity[face] ^ neighbor.flip;
        queue.push(neighbor.face);
      });
    }

    const hasBoundary = faces.some((face) => boundaryFaces.has(face));
    let signedVolume = 0;
    let weightedNormal = [0, 0, 0];

    faces.forEach((faceIndex) => {
      const face = mesh.faces[faceIndex];
      const a = mesh.positions[face[0]];
      const b = mesh.positions[face[1]];
      const c = mesh.positions[face[2]];
      const sign = parity[faceIndex] ? -1 : 1;
      const { normal } = faceNormal(mesh, face);
      weightedNormal[0] += normal[0] * sign;
      weightedNormal[1] += normal[1] * sign;
      weightedNormal[2] += normal[2] * sign;
      signedVolume +=
        ((a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
          6) *
        sign;
    });

    let invertComponent = false;
    if (!hasBoundary && Math.abs(signedVolume) > EPS) {
      invertComponent = signedVolume < 0;
    } else {
      invertComponent = weightedNormal[1] < -EPS;
      if (Math.abs(weightedNormal[1]) <= EPS) {
        const axis = weightedNormal
          .map((value, index) => [Math.abs(value), index])
          .sort((a, b) => b[0] - a[0])[0][1];
        invertComponent = weightedNormal[axis] < 0;
      }
    }

    if (invertComponent) {
      faces.forEach((face) => {
        parity[face] ^= 1;
      });
    }

    const flipFaces =
      faces.length === 1 ? [] : faces.filter((face) => parity[face] === 1);
    if (flipFaces.length) {
      const vertices = [
        ...new Set(flipFaces.flatMap((faceIndex) => mesh.faces[faceIndex])),
      ].sort((a, b) => a - b);
      groups.push({
        faces: flipFaces.sort((a, b) => a - b),
        vertices,
        componentFaces: faces.sort((a, b) => a - b),
        closed: !hasBoundary,
        mode: !hasBoundary && invertComponent ? 'inward' : 'winding',
      });
    }
  }
  return groups;
}

function groupNonManifold(edges) {
  if (!edges.length) return [];
  const parent = edges.map((_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const endpoints = new Set([edges[i].a, edges[i].b]);
      if (endpoints.has(edges[j].a) || endpoints.has(edges[j].b)) union(i, j);
    }
  }

  const groups = new Map();
  edges.forEach((edge, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(edge);
  });
  return [...groups.values()]
    .map((group) => ({
      edges: group,
      vertices: [...new Set(group.flatMap((edge) => [edge.a, edge.b]))].sort(
        (a, b) => a - b,
      ),
      faces: [...new Set(group.flatMap((edge) => edge.faces))].sort(
        (a, b) => a - b,
      ),
    }))
    .sort((a, b) => a.faces[0] - b.faces[0]);
}

export function analyzeMesh(mesh) {
  const topology = buildTopology(mesh);
  const components = faceComponents(mesh, topology);
  const duplicateGroups = findDuplicateGroups(mesh);
  const nonManifoldGroups = groupNonManifold(topology.nonManifoldEdges);
  const normalGroups = orientComponents(mesh, topology);
  const boundaryLoops = buildBoundaryLoops(topology);
  const isolatedFaces = components
    .filter((component) => component.length === 1)
    .map((component) => component[0]);
  const usedVertices = new Set(mesh.faces.flat());
  const edges = topology.edgeList.length;
  const closed =
    mesh.faces.length > 0 &&
    topology.boundaryEdges.length === 0 &&
    topology.nonManifoldEdges.length === 0;
  const nonManifold = topology.nonManifoldEdges.length > 0;
  const open = topology.boundaryEdges.length > 0;

  return {
    topology,
    components,
    duplicateGroups,
    nonManifoldGroups,
    normalGroups,
    boundaryLoops,
    isolatedFaces,
    stats: {
      vertices: usedVertices.size,
      faces: mesh.faces.length,
      edges,
      components: components.length,
      boundaryEdges: topology.boundaryEdges.length,
      boundaryLoops: boundaryLoops.length,
      nonManifoldEdges: topology.nonManifoldEdges.length,
      duplicateGroups: duplicateGroups.filter((group) => !group.intentional).length,
      duplicateVertices: duplicateGroups
        .filter((group) => !group.intentional)
        .reduce((sum, group) => sum + group.vertices.length - 1, 0),
      isolatedFaces: isolatedFaces.length,
      normalGroups: normalGroups.length,
      flippedFaces: normalGroups.reduce((sum, group) => sum + group.faces.length, 0),
      euler: usedVertices.size - edges + mesh.faces.length,
    },
    closed,
    open,
    nonManifold,
    kind: closed ? 'CLOSED_SOLID' : nonManifold ? 'NON_MANIFOLD' : 'OPEN_SURFACE',
  };
}

export function formatRanges(indices, prefix) {
  const values = [...new Set(indices)].sort((a, b) => a - b);
  if (!values.length) return '—';
  const ranges = [];
  let start = values[0];
  let previous = values[0];
  for (let i = 1; i <= values.length; i += 1) {
    const value = values[i];
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    const first = `${prefix}${String(start + 1).padStart(2, '0')}`;
    const last = `${prefix}${String(previous + 1).padStart(2, '0')}`;
    ranges.push(start === previous ? first : `${first}–${last}`);
    start = value;
    previous = value;
  }
  return ranges.join(' · ');
}

export function buildDefectView(analysis) {
  return [
    {
      key: 'nonmanifold',
      code: 'NM',
      title: '非流形边',
      count: analysis.nonManifoldGroups.length,
      detail: `${analysis.stats.nonManifoldEdges} 条边入射 > 2 面`,
      severity: 'decision',
      groups: analysis.nonManifoldGroups.map((group, index) => ({
        id: `nm-${index}`,
        ...group,
      })),
    },
    {
      key: 'duplicates',
      code: 'DV',
      title: '重复顶点',
      count: analysis.stats.duplicateGroups,
      detail: `${analysis.stats.duplicateVertices} 个可合并顶点`,
      severity: 'repairable',
      groups: analysis.duplicateGroups
        .filter((group) => !group.intentional)
        .map((group, index) => ({ id: `dv-${index}`, ...group })),
    },
    {
      key: 'isolated',
      code: 'IF',
      title: '孤立面',
      count: analysis.isolatedFaces.length,
      detail: `${analysis.isolatedFaces.length} 个单面连通块`,
      severity: 'decision',
      groups: analysis.isolatedFaces.map((face, index) => ({
        id: `if-${index}`,
        faces: [face],
        vertices: [...meshFaceVertices(analysis, face)],
      })),
    },
    {
      key: 'normals',
      code: 'NR',
      title: '反向 / 不一致法线',
      count: analysis.normalGroups.length,
      detail: `${analysis.stats.flippedFaces} 个面需翻转`,
      severity: 'repairable',
      groups: analysis.normalGroups.map((group, index) => ({
        id: `nr-${index}`,
        ...group,
      })),
    },
    {
      key: 'boundary',
      code: 'BD',
      title: '开放边界',
      count: analysis.boundaryLoops.length,
      detail: `${analysis.stats.boundaryEdges} 条边界边`,
      severity: 'decision',
      groups: analysis.boundaryLoops.map((loop, index) => ({
        id: `bd-${index}`,
        vertices: loop.vertices,
        faces: [
          ...new Set(
            loop.edgeIndices.map(
              (edgeIndex) => analysis.topology.boundaryEdges[edgeIndex].faces[0],
            ),
          ),
        ].sort((a, b) => a - b),
        loop,
      })),
    },
  ];
}

function meshFaceVertices(analysis, faceIndex) {
  const all = new Set();
  const faceSet = new Set([faceIndex]);
  for (const edge of analysis.topology.edgeList) {
    if (edge.faces.some((face) => faceSet.has(face))) {
      all.add(edge.a);
      all.add(edge.b);
    }
  }
  return all;
}
