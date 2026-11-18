import { buildTopology, cloneMesh, edgeKey } from './meshCore.js';

function compactVertices(mesh) {
  const used = [...new Set(mesh.faces.flat())].sort((a, b) => a - b);
  const remap = new Map(used.map((vertex, index) => [vertex, index]));
  mesh.positions = used.map((vertex) => mesh.positions[vertex].slice());
  mesh.faces = mesh.faces.map((face) => face.map((vertex) => remap.get(vertex)));
  mesh.protectedPairs = new Set(
    [...mesh.protectedPairs]
      .map((pair) => pair.split(':').map(Number))
      .filter(([a, b]) => remap.has(a) && remap.has(b))
      .map(([a, b]) => edgeKey(remap.get(a), remap.get(b))),
  );
  return mesh;
}

export function weldDuplicateVertices(meshInput, analysis, selectedGroups = null) {
  const mesh = cloneMesh(meshInput);
  const available = analysis.duplicateGroups.filter((group) => !group.intentional);
  const groups = selectedGroups?.length
    ? available.filter((_, index) => selectedGroups.includes(index))
    : available;
  if (!groups.length) return { mesh, changed: 0, skipped: 0 };

  const safeGroups = groups.filter((group) => {
    const set = new Set(group.vertices);
    return !mesh.faces.some(
      (face) => face.filter((vertex) => set.has(vertex)).length > 1,
    );
  });
  const skipped = groups.length - safeGroups.length;
  if (!safeGroups.length) {
    return { mesh, changed: 0, skipped };
  }

  const remap = new Map();
  safeGroups.forEach((group) => {
    const target = Math.min(...group.vertices);
    group.vertices.forEach((vertex) => remap.set(vertex, target));
  });
  mesh.faces = mesh.faces.map((face) =>
    face.map((vertex) => (remap.has(vertex) ? remap.get(vertex) : vertex)),
  );
  mesh.protectedPairs = new Set(
    [...mesh.protectedPairs]
      .map((pair) => pair.split(':').map(Number))
      .filter(([a, b]) => !remap.has(a) && !remap.has(b))
      .map(([a, b]) => edgeKey(a, b)),
  );
  compactVertices(mesh);
  return { mesh, changed: safeGroups.length, skipped };
}

export function flipFaces(meshInput, faces) {
  const mesh = cloneMesh(meshInput);
  const uniqueFaces = [...new Set(faces)].filter(
    (index) => index >= 0 && index < mesh.faces.length,
  );
  uniqueFaces.forEach((index) => {
    mesh.faces[index] = [mesh.faces[index][0], mesh.faces[index][2], mesh.faces[index][1]];
  });
  return { mesh, changed: uniqueFaces.length };
}

export function removeFaces(meshInput, faces, removedInput) {
  const mesh = cloneMesh(meshInput);
  const removal = new Set(
    [...new Set(faces)].filter((index) => index >= 0 && index < mesh.faces.length),
  );
  const removed = removedInput.map((entry) => ({ ...entry }));
  removal.forEach((index) => {
    removed.push({
      sourceFace: mesh.faceMap[index],
      removedAt: mesh.faces.length,
      reason: 'isolated',
    });
  });

  mesh.faces = mesh.faces.filter((_, index) => !removal.has(index));
  mesh.faceMap = mesh.faceMap.filter((_, index) => !removal.has(index));
  compactVertices(mesh);
  return { mesh, removed, changed: removal.size };
}

function manifoldComponents(faceCount, topology) {
  const adjacency = Array.from({ length: faceCount }, () => []);
  topology.manifoldEdges.forEach((edge) => {
    const [a, b] = edge.faces;
    adjacency[a].push(b);
    adjacency[b].push(a);
  });

  const seen = new Uint8Array(faceCount);
  const branches = [];
  for (let start = 0; start < faceCount; start += 1) {
    if (seen[start]) continue;
    const queue = [start];
    const branch = [];
    seen[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const face = queue[cursor];
      branch.push(face);
      adjacency[face].forEach((neighbor) => {
        if (seen[neighbor]) return;
        seen[neighbor] = 1;
        queue.push(neighbor);
      });
    }
    branches.push(branch.sort((a, b) => a - b));
  }
  return branches;
}

export function splitNonManifoldBranches(meshInput, analysis, selectedGroups = null) {
  const mesh = cloneMesh(meshInput);
  const topology = buildTopology(mesh);
  const components = manifoldComponents(mesh.faces.length, topology);
  const componentByFace = new Map();
  components.forEach((faces, componentIndex) => {
    faces.forEach((face) => componentByFace.set(face, componentIndex));
  });
  const groups =
    selectedGroups?.length
      ? analysis.nonManifoldGroups.filter((_, index) => selectedGroups.includes(index))
      : analysis.nonManifoldGroups;
  let copiedVertices = 0;
  let splitEdges = 0;
  let unresolvedGroups = 0;

  groups.forEach((group) => {
    const branchIds = [...new Set(group.faces.map((face) => componentByFace.get(face)))].sort(
      (a, b) => a - b,
    );
    if (branchIds.length < 2) {
      unresolvedGroups += 1;
      return;
    }
    splitEdges += group.edges.length;
    branchIds.slice(1).forEach((componentIndex) => {
      const remap = new Map();
      group.vertices.forEach((vertex) => {
        const copy = mesh.positions.length;
        mesh.positions.push(mesh.positions[vertex].slice());
        remap.set(vertex, copy);
        mesh.protectedPairs.add(edgeKey(vertex, copy));
        copiedVertices += 1;
      });
      components[componentIndex].forEach((faceIndex) => {
        mesh.faces[faceIndex] = mesh.faces[faceIndex].map((vertex) =>
          remap.has(vertex) ? remap.get(vertex) : vertex,
        );
      });
    });
  });

  return {
    mesh,
    copiedVertices,
    splitEdges,
    unresolvedGroups,
    changed: groups.length - unresolvedGroups,
  };
}

export function capBoundaryLoops(meshInput, analysis, selectedLoops = null) {
  const mesh = cloneMesh(meshInput);
  const loops =
    selectedLoops?.length
      ? analysis.boundaryLoops.filter((_, index) => selectedLoops.includes(index))
      : analysis.boundaryLoops;
  let addedFaces = 0;
  loops.forEach((loop) => {
    if (loop.vertices.length < 3) return;
    const center = [0, 0, 0];
    loop.vertices.forEach((vertex) => {
      const point = mesh.positions[vertex];
      center[0] += point[0];
      center[1] += point[1];
      center[2] += point[2];
    });
    center[0] /= loop.vertices.length;
    center[1] /= loop.vertices.length;
    center[2] /= loop.vertices.length;
    const centerIndex = mesh.positions.length;
    mesh.positions.push(center);
    for (let i = 0; i < loop.vertices.length; i += 1) {
      const from = loop.vertices[i];
      const to = loop.vertices[(i + 1) % loop.vertices.length];
      mesh.faces.push([to, from, centerIndex]);
      mesh.faceMap.push(null);
      addedFaces += 1;
    }
  });
  return { mesh, changed: loops.length, addedFaces };
}

export function buildFaceCorrespondence(mesh, removed = []) {
  const outputs = new Map();
  mesh.faceMap.forEach((sourceFace, outputFace) => {
    if (sourceFace === null || sourceFace === undefined) return;
    if (!outputs.has(sourceFace)) outputs.set(sourceFace, []);
    outputs.get(sourceFace).push(outputFace);
  });
  const removedBySource = new Map(
    removed.map((entry) => [entry.sourceFace, entry.reason || 'removed']),
  );

  return Array.from({ length: mesh.sourceFaceCount }, (_, sourceFace) => ({
    sourceFace,
    outputFaces: outputs.get(sourceFace) || [],
    status: outputs.has(sourceFace)
      ? 'preserved'
      : removedBySource.has(sourceFace)
        ? removedBySource.get(sourceFace)
        : 'missing',
  }));
}
