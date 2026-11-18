const CELL_EPSILON = 1e-9;

export function makeMesh({ id, name, description, rest, triangles, fixed = [], control }) {
  const positions = Float64Array.from(rest);
  return {
    id,
    name,
    description,
    rest: Float64Array.from(rest),
    positions,
    triangles: triangles.map((triangle) => [...triangle]),
    fixed: new Set(fixed),
    control,
  };
}

export function resetMesh(mesh) {
  mesh.positions = Float64Array.from(mesh.rest);
  return mesh;
}

function cellKey(x, y) {
  return `${x}:${y}`;
}

function buildGrid({
  cellsX,
  cellsY,
  width,
  height,
  originX = 0,
  originY = 0,
  holeCells = new Set(),
}) {
  const vertices = [];
  const indexByCellVertex = new Map();

  for (let y = 0; y <= cellsY; y += 1) {
    for (let x = 0; x <= cellsX; x += 1) {
      const index = vertices.length / 2;
      vertices.push(
        originX + (x / cellsX - 0.5) * width,
        originY + (y / cellsY - 0.5) * height,
      );
      indexByCellVertex.set(cellKey(x, y), index);
    }
  }

  const rawTriangles = [];
  for (let y = 0; y < cellsY; y += 1) {
    for (let x = 0; x < cellsX; x += 1) {
      if (holeCells.has(cellKey(x, y))) continue;
      const a = indexByCellVertex.get(cellKey(x, y));
      const b = indexByCellVertex.get(cellKey(x + 1, y));
      const c = indexByCellVertex.get(cellKey(x + 1, y + 1));
      const d = indexByCellVertex.get(cellKey(x, y + 1));
      if ((x + y) % 2 === 0) {
        rawTriangles.push([a, b, d], [b, c, d]);
      } else {
        rawTriangles.push([a, b, c], [a, c, d]);
      }
    }
  }

  const used = new Set(rawTriangles.flat());
  const remap = new Map();
  const positions = [];
  for (let oldIndex = 0; oldIndex < vertices.length / 2; oldIndex += 1) {
    if (!used.has(oldIndex)) continue;
    remap.set(oldIndex, positions.length / 2);
    positions.push(vertices[oldIndex * 2], vertices[oldIndex * 2 + 1]);
  }

  return {
    positions: Float64Array.from(positions),
    triangles: rawTriangles.map((triangle) => triangle.map((index) => remap.get(index))),
  };
}

function offsetPart(part, offsetX, offsetY) {
  const positions = Float64Array.from(part.positions);
  for (let index = 0; index < positions.length; index += 2) {
    positions[index] += offsetX;
    positions[index + 1] += offsetY;
  }
  return { positions, triangles: part.triangles };
}

function combineParts(parts) {
  const positions = [];
  const triangles = [];
  for (const part of parts) {
    const base = positions.length / 2;
    positions.push(...part.positions);
    for (const triangle of part.triangles) {
      triangles.push(triangle.map((index) => index + base));
    }
  }
  return { positions: Float64Array.from(positions), triangles };
}

function nearestVertex(positions, x, y) {
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < positions.length; index += 2) {
    const dx = positions[index] - x;
    const dy = positions[index + 1] - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index / 2;
    }
  }
  return best;
}

function minimumXIndices(positions) {
  let minX = Infinity;
  for (let index = 0; index < positions.length; index += 2) {
    minX = Math.min(minX, positions[index]);
  }
  const fixed = [];
  for (let index = 0; index < positions.length; index += 2) {
    if (Math.abs(positions[index] - minX) <= CELL_EPSILON * 100) {
      fixed.push(index / 2);
    }
  }
  return fixed;
}

export function createStripMesh() {
  const grid = buildGrid({
    cellsX: 28,
    cellsY: 4,
    width: 8.6,
    height: 1.45,
  });
  const fixed = minimumXIndices(grid.positions);
  const control = nearestVertex(grid.positions, 4.3, 0);
  return makeMesh({
    id: "strip",
    name: "长条弯折",
    description: "细长条带，左端固定；拖动右端控制点产生大曲率弯折。",
    rest: grid.positions,
    triangles: grid.triangles,
    fixed,
    control,
  });
}

export function createPerforatedMesh() {
  const holes = new Set();
  const rectangles = [
    [4, 3, 2, 3],
    [9, 7, 3, 2],
    [12, 2, 2, 3],
  ];
  for (const [startX, startY, sizeX, sizeY] of rectangles) {
    for (let y = startY; y < startY + sizeY; y += 1) {
      for (let x = startX; x < startX + sizeX; x += 1) {
        holes.add(cellKey(x, y));
      }
    }
  }
  const grid = buildGrid({
    cellsX: 18,
    cellsY: 12,
    width: 7.2,
    height: 5,
    holeCells: holes,
  });
  const fixed = minimumXIndices(grid.positions);
  const control = nearestVertex(grid.positions, 3.6, 0);
  return makeMesh({
    id: "perforated",
    name: "带孔薄片",
    description: "三处矩形孔洞的薄片，验证孔洞拓扑与边界在变形中保持。",
    rest: grid.positions,
    triangles: grid.triangles,
    fixed,
    control,
  });
}

export function createDisconnectedMesh() {
  const main = buildGrid({
    cellsX: 16,
    cellsY: 4,
    width: 6,
    height: 1.5,
    originX: -1.2,
  });
  const island = offsetPart(
    buildGrid({ cellsX: 4, cellsY: 4, width: 1.4, height: 1.4, originX: 0, originY: 0 }),
    3.35,
    0.15,
  );
  const combined = combineParts([main, island]);
  const fixed = minimumXIndices(combined.positions);
  const control = nearestVertex(combined.positions, 1.8, 0);
  return makeMesh({
    id: "disconnected",
    name: "不连通网格",
    description: "主条带左侧固定，右侧孤岛没有约束；求解器必须报告并跳过该分量。",
    rest: combined.positions,
    triangles: combined.triangles,
    fixed,
    control,
  });
}

export function createPresets() {
  return [createStripMesh(), createPerforatedMesh(), createDisconnectedMesh()];
}

export function buildEdges(mesh) {
  const edgeMap = new Map();
  for (const triangle of mesh.triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = triangle[corner];
      const b = triangle[(corner + 1) % 3];
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      edgeMap.set(`${low}:${high}`, { a: low, b: high, weight: 1 });
    }
  }
  return [...edgeMap.values()];
}

export function meshComponents(mesh) {
  const parent = Array.from({ length: mesh.rest.length / 2 }, (_, index) => index);
  const find = (node) => {
    let root = node;
    while (parent[root] !== root) root = parent[root];
    while (parent[node] !== node) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  for (const edge of buildEdges(mesh)) union(edge.a, edge.b);

  const groups = new Map();
  for (let index = 0; index < parent.length; index += 1) {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(index);
  }
  return [...groups.values()];
}

export function meshBounds(mesh, positions = mesh.positions) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < positions.length; index += 2) {
    minX = Math.min(minX, positions[index]);
    maxX = Math.max(maxX, positions[index]);
    minY = Math.min(minY, positions[index + 1]);
    maxY = Math.max(maxY, positions[index + 1]);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function nearestVertexTo(positions, x, y) {
  return nearestVertex(positions, x, y);
}

export function clonePositions(positions) {
  return Float64Array.from(positions);
}

export function meshToOBJ(mesh, positions, metadata = {}) {
  const lines = [
    `# ${metadata.title || mesh.name}`,
    `# generator: ARAP Mesh Studio`,
    `# convergence: ${metadata.stopReason || "n/a"}`,
    `# iterations: ${metadata.iterations ?? "n/a"}`,
    `# energy: ${metadata.energy ?? "n/a"}`,
    `# rigid_residual: ${metadata.rigidResidual ?? "n/a"}`,
    `# pinned_vertices: ${[...mesh.fixed].join(",")}`,
  ];
  for (let index = 0; index < positions.length; index += 2) {
    lines.push(`v ${positions[index].toFixed(8)} ${positions[index + 1].toFixed(8)} 0`);
  }
  for (const triangle of mesh.triangles) {
    lines.push(`f ${triangle.map((index) => index + 1).join(" ")}`);
  }
  return `${lines.join("\n")}\n`;
}
