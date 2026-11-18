export const EPS = 1e-5;

const PAIR_KEY = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export function createMesh(name, positions, faces, options = {}) {
  return {
    name,
    positions: positions.map((point) => point.slice(0, 3)),
    faces: faces.map((face) => face.slice(0, 3)),
    faceMap: faces.map((_, index) => index),
    sourceFaceCount: faces.length,
    protectedPairs: new Set(options.protectedPairs || []),
  };
}

export function cloneMesh(mesh) {
  return {
    name: mesh.name,
    positions: mesh.positions.map((point) => point.slice()),
    faces: mesh.faces.map((face) => face.slice()),
    faceMap: mesh.faceMap.slice(),
    sourceFaceCount: mesh.sourceFaceCount,
    protectedPairs: new Set(mesh.protectedPairs),
  };
}

export function cloneSnapshot(snapshot) {
  return {
    mesh: cloneMesh(snapshot.mesh),
    removed: snapshot.removed.map((entry) => ({ ...entry })),
  };
}

export function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function faceNormal(mesh, face) {
  const a = mesh.positions[face[0]];
  const b = mesh.positions[face[1]];
  const c = mesh.positions[face[2]];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return { normal, area: Math.hypot(...normal) * 0.5 };
}

export function buildTopology(mesh) {
  const edges = new Map();
  const addEdge = (from, to, faceIndex) => {
    const key = edgeKey(from, to);
    let edge = edges.get(key);
    if (!edge) {
      edge = {
        key,
        a: Math.min(from, to),
        b: Math.max(from, to),
        faces: [],
        directions: [],
      };
      edges.set(key, edge);
    }
    edge.faces.push(faceIndex);
    edge.directions.push([from, to]);
  };

  mesh.faces.forEach((face, index) => {
    addEdge(face[0], face[1], index);
    addEdge(face[1], face[2], index);
    addEdge(face[2], face[0], index);
  });

  const edgeList = [...edges.values()];
  return {
    edges,
    edgeList,
    boundaryEdges: edgeList.filter((edge) => edge.faces.length === 1),
    nonManifoldEdges: edgeList.filter((edge) => edge.faces.length > 2),
    manifoldEdges: edgeList.filter((edge) => edge.faces.length === 2),
  };
}

function makeAdjacency(faceCount, edges, predicate) {
  const adjacency = Array.from({ length: faceCount }, () => []);
  edges.forEach((edge) => {
    if (!predicate(edge)) return;
    for (let i = 0; i < edge.faces.length; i += 1) {
      for (let j = i + 1; j < edge.faces.length; j += 1) {
        const a = edge.faces[i];
        const b = edge.faces[j];
        adjacency[a].push(b);
        adjacency[b].push(a);
      }
    }
  });
  return adjacency;
}

function connectedComponents(nodeCount, adjacency) {
  const seen = new Uint8Array(nodeCount);
  const components = [];
  for (let start = 0; start < nodeCount; start += 1) {
    if (seen[start]) continue;
    const queue = [start];
    const component = [];
    seen[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const node = queue[cursor];
      component.push(node);
      for (const neighbor of adjacency[node]) {
        if (seen[neighbor]) continue;
        seen[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    components.push(component.sort((a, b) => a - b));
  }
  return components;
}

export function faceComponents(mesh, topology) {
  const adjacency = makeAdjacency(
    mesh.faces.length,
    topology.edgeList,
    (edge) => edge.faces.length >= 2,
  );
  return connectedComponents(mesh.faces.length, adjacency);
}

function usedVertices(mesh) {
  const used = new Set();
  mesh.faces.forEach((face) => face.forEach((vertex) => used.add(vertex)));
  return used;
}

export function findDuplicateGroups(mesh) {
  const used = [...usedVertices(mesh)].sort(
    (a, b) => mesh.positions[a][0] - mesh.positions[b][0],
  );
  const parent = new Map(used.map((vertex) => [vertex, vertex]));
  const find = (vertex) => {
    let cursor = vertex;
    while (parent.get(cursor) !== cursor) {
      parent.set(cursor, parent.get(parent.get(cursor)));
      cursor = parent.get(cursor);
    }
    return cursor;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (let i = 0; i < used.length; i += 1) {
    const a = used[i];
    const pa = mesh.positions[a];
    for (let j = i + 1; j < used.length; j += 1) {
      const b = used[j];
      const pb = mesh.positions[b];
      if (pb[0] - pa[0] > EPS) break;
      const distance = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      if (distance <= EPS) union(a, b);
    }
  }

  const groups = new Map();
  used.forEach((vertex) => {
    const root = find(vertex);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(vertex);
  });

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const vertexSet = new Set(group);
      const faces = [];
      mesh.faces.forEach((face, faceIndex) => {
        if (face.some((vertex) => vertexSet.has(vertex))) faces.push(faceIndex);
      });
      const intentional = group.every((a, index) =>
        group.slice(index + 1).every((b) => mesh.protectedPairs.has(PAIR_KEY(a, b))),
      );
      return { vertices: group, faces, intentional };
    })
    .sort((a, b) => a.vertices[0] - b.vertices[0]);
}

function groupNonManifoldEdges(edges) {
  const parent = edges.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      if (edges[i].a === edges[j].a || edges[i].a === edges[j].b) union(i, j);
      else if (edges[i].b === edges[j].a || edges[i].b === edges[j].b) union(i, j);
    }
  }

  const groups = new Map();
  edges.forEach((edge, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(edge);
  });

  return [...groups.values()]
    .map((groupEdges) => {
      const vertices = [...new Set(groupEdges.flatMap((edge) => [edge.a, edge.b]))].sort(
        (a, b) => a - b,
      );
      const faces = [...new Set(groupEdges.flatMap((edge) => edge.faces))].sort(
        (a, b) => a - b,
      );
      return { vertices, faces, edges: groupEdges };
    })
    .sort((a, b) => a.faces[0] - b.faces[0]);
}

export function buildBoundaryLoops(topology) {
  const boundary = topology.boundaryEdges;
  if (!boundary.length) return [];
  const incident = new Map();
  boundary.forEach((edge, index) => {
    if (!incident.has(edge.a)) incident.set(edge.a, []);
    if (!incident.has(edge.b)) incident.set(edge.b, []);
    incident.get(edge.a).push(index);
    incident.get(edge.b).push(index);
  });

  const visited = new Set();
  const loops = [];
  boundary.forEach((edge, startIndex) => {
    if (visited.has(startIndex)) return;
    const firstFrom = edge.directions[0][0];
    const firstTo = edge.directions[0][1];
    const vertices = [firstFrom, firstTo];
    const edgeIndices = [startIndex];
    visited.add(startIndex);
    let previous = firstFrom;
    let current = firstTo;
    let guard = 0;

    while (current !== vertices[0] && guard < boundary.length + 2) {
      guard += 1;
      const options = (incident.get(current) || []).filter(
        (candidate) => !visited.has(candidate),
      );
      if (!options.length) break;
      const nextIndex = options[0];
      const nextEdge = boundary[nextIndex];
      const next = nextEdge.a === current ? nextEdge.b : nextEdge.a;
      visited.add(nextIndex);
      edgeIndices.push(nextIndex);
      vertices.push(next);
      previous = current;
      current = next;
    }

    if (vertices.length > 2 && current === vertices[0]) {
      vertices.pop();
      loops.push({ vertices, edgeIndices, previous });
    }
  });
  return loops;
}
