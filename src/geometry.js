const EPSILON = 1e-10;

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a, factor) {
  return { x: a.x * factor, y: a.y * factor };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function lengthSquared(a) {
  return a.x * a.x + a.y * a.y;
}

export function length(a) {
  return Math.hypot(a.x, a.y);
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function polygonSignedArea(vertices) {
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const next = (index + 1) % vertices.length;
    area += vertices[index].x * vertices[next].y - vertices[next].x * vertices[index].y;
  }
  return area / 2;
}

export function polygonBounds(vertices) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of vertices) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function cycleEdges(vertexCount) {
  if (!Number.isInteger(vertexCount) || vertexCount < 1) return [];
  return Array.from({ length: vertexCount }, (_, index) => [index, (index + 1) % vertexCount]);
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function orderedCycle(vertexCount, edges) {
  if (!Array.isArray(edges) || vertexCount < 3) return null;

  const adjacency = Array.from({ length: vertexCount }, () => []);
  const seenEdges = new Set();

  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) return null;
    const [a, b] = edge;
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    if (a === b || a < 0 || b < 0 || a >= vertexCount || b >= vertexCount) return null;
    const key = edgeKey(a, b);
    if (seenEdges.has(key)) return null;
    seenEdges.add(key);
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  if (adjacency.some((neighbors) => neighbors.length !== 2)) return null;

  const ordered = [];
  const visited = new Set();
  let previous = -1;
  let current = 0;

  for (let step = 0; step < vertexCount; step += 1) {
    if (visited.has(current)) return null;
    visited.add(current);
    ordered.push(current);
    const [first, second] = adjacency[current];
    const next = first === previous ? second : first;
    previous = current;
    current = next;
  }

  if (current !== 0 || visited.size !== vertexCount) return null;
  return ordered;
}

function orientation(a, b, c) {
  const first = subtract(b, a);
  const second = subtract(c, a);
  const tolerance = EPSILON * Math.max(1, length(first) * length(second));
  const value = cross(first, second);
  if (Math.abs(value) <= tolerance) return 0;
  return value > 0 ? 1 : -1;
}

function onSegment(a, b, point) {
  const tolerance = EPSILON * Math.max(1, length(subtract(b, a)));
  return (
    Math.min(a.x, b.x) - tolerance <= point.x &&
    point.x <= Math.max(a.x, b.x) + tolerance &&
    Math.min(a.y, b.y) - tolerance <= point.y &&
    point.y <= Math.max(a.y, b.y) + tolerance
  );
}

export function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

export function pointInPolygon(point, vertices, includeBoundary = true) {
  let inside = false;

  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const a = vertices[previous];
    const b = vertices[index];
    if (includeBoundary && distancePointToSegment(point, a, b) <= EPSILON) return true;

    const crossesRay =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crossesRay) inside = !inside;
  }

  return inside;
}

export function distancePointToSegment(point, a, b) {
  const segment = subtract(b, a);
  const segmentLengthSquared = lengthSquared(segment);
  if (segmentLengthSquared <= EPSILON * EPSILON) return distance(point, a);
  const t = clamp(dot(subtract(point, a), segment) / segmentLengthSquared, 0, 1);
  return distance(point, add(a, scale(segment, t)));
}

function segmentProjectionParameter(point, a, b) {
  const segment = subtract(b, a);
  const segmentLengthSquared = lengthSquared(segment);
  if (segmentLengthSquared <= EPSILON * EPSILON) return 0;
  return clamp(dot(subtract(point, a), segment) / segmentLengthSquared, 0, 1);
}

function polygonSelfIntersections(vertices) {
  const intersections = [];
  const count = vertices.length;

  for (let first = 0; first < count; first += 1) {
    const a = vertices[first];
    const b = vertices[(first + 1) % count];
    if (distance(a, b) <= EPSILON) {
      intersections.push({ kind: 'zero-length', first, second: first });
      continue;
    }

    for (let second = first + 1; second < count; second += 1) {
      const c = vertices[second];
      const d = vertices[(second + 1) % count];
      const adjacent = second === first + 1 || (first === 0 && second === count - 1);
      if (!segmentsIntersect(a, b, c, d)) continue;

      if (adjacent) {
        const shared = second === first + 1 ? b : a;
        const firstOuter = second === first + 1 ? a : b;
        const secondOuter = second === first + 1 ? d : c;
        const incoming = subtract(shared, firstOuter);
        const outgoing = subtract(secondOuter, shared);
        const collinear = Math.abs(cross(incoming, outgoing)) <= EPSILON * Math.max(1, length(incoming) * length(outgoing));
        if (collinear && dot(incoming, outgoing) < -EPSILON) {
          intersections.push({ kind: 'overlap', first, second });
        }
        continue;
      }

      intersections.push({ kind: 'crossing', first, second });
    }
  }

  return intersections;
}

export function validateCage(vertices, edges) {
  const errors = [];
  if (!Array.isArray(vertices) || vertices.length < 3) {
    errors.push('控制笼至少需要 3 个顶点。');
  }
  if (!Array.isArray(edges) || edges.length < 3) {
    errors.push('控制笼至少需要 3 条边。');
  }
  if (errors.length > 0) {
    return { valid: false, closed: false, simple: false, errors, cycle: null, intersections: [] };
  }

  if (vertices.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
    errors.push('控制笼包含非有限坐标。');
  }
  if (edges.length !== vertices.length) {
    errors.push('闭合控制笼的边数必须等于顶点数。');
  }

  const cycle = orderedCycle(vertices.length, edges);
  if (!cycle) {
    errors.push('控制笼边没有组成单一闭合环。');
    return { valid: false, closed: false, simple: false, errors, cycle: null, intersections: [] };
  }

  const orderedVertices = cycle.map((index) => vertices[index]);
  const intersections = polygonSelfIntersections(orderedVertices);
  if (intersections.length > 0) {
    errors.push(`控制笼存在自交或重叠边（${intersections.length} 处）。`);
  }
  if (Math.abs(polygonSignedArea(orderedVertices)) <= EPSILON) {
    errors.push('控制笼面积为零。');
  }

  return {
    valid: errors.length === 0,
    closed: true,
    simple: intersections.length === 0,
    errors,
    cycle,
    intersections,
  };
}

export function normalizeCageOrder(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return null;
  const edges = cycleEdges(vertices.length);
  const cycle = orderedCycle(vertices.length, edges);
  if (!cycle) return null;
  const ordered = cycle.map((index) => ({ ...vertices[index] }));
  const area = polygonSignedArea(ordered);
  if (area < 0) ordered.reverse();
  return { vertices: ordered, edges: cycleEdges(ordered.length) };
}

function pointInTriangle(point, a, b, c, includeBoundary = true) {
  const first = orientation(a, b, point);
  const second = orientation(b, c, point);
  const third = orientation(c, a, point);
  if (!includeBoundary) return first > 0 && second > 0 && third > 0;
  return first >= 0 && second >= 0 && third >= 0;
}

export function triangulatePolygon(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return [];
  if (Math.abs(polygonSignedArea(vertices)) <= EPSILON) return [];

  const polygon = vertices.map((_, index) => index);
  if (polygonSignedArea(vertices) < 0) polygon.reverse();
  const triangles = [];
  let guard = polygon.length * polygon.length;

  while (polygon.length > 3 && guard > 0) {
    guard -= 1;
    let earFound = false;

    for (let index = 0; index < polygon.length; index += 1) {
      const previousIndex = polygon[(index - 1 + polygon.length) % polygon.length];
      const currentIndex = polygon[index];
      const nextIndex = polygon[(index + 1) % polygon.length];
      const a = vertices[previousIndex];
      const b = vertices[currentIndex];
      const c = vertices[nextIndex];

      if (orientation(a, b, c) <= 0) continue;
      let containsVertex = false;
      for (const candidateIndex of polygon) {
        if (candidateIndex === previousIndex || candidateIndex === currentIndex || candidateIndex === nextIndex) {
          continue;
        }
        const candidate = vertices[candidateIndex];
        if (
          orientation(a, b, candidate) >= 0 &&
          orientation(b, c, candidate) >= 0 &&
          orientation(c, a, candidate) >= 0
        ) {
          containsVertex = true;
          break;
        }
      }
      if (containsVertex) continue;

      triangles.push([previousIndex, currentIndex, nextIndex]);
      polygon.splice(index, 1);
      earFound = true;
      break;
    }

    if (earFound) continue;

    const collinearIndex = polygon.findIndex((currentIndex, index) => {
      const previousIndex = polygon[(index - 1 + polygon.length) % polygon.length];
      const nextIndex = polygon[(index + 1) % polygon.length];
      return orientation(vertices[previousIndex], vertices[currentIndex], vertices[nextIndex]) === 0;
    });
    if (collinearIndex >= 0) {
      polygon.splice(collinearIndex, 1);
      continue;
    }
    break;
  }

  if (polygon.length === 3) {
    triangles.push([polygon[0], polygon[1], polygon[2]]);
  }
  return triangles;
}

function barycentricLattice(a, b, c, resolution) {
  const grid = [];
  for (let row = 0; row <= resolution; row += 1) {
    const rowPoints = [];
    for (let column = 0; column <= resolution - row; column += 1) {
      const u = column / resolution;
      const v = row / resolution;
      rowPoints.push({
        x: a.x + (b.x - a.x) * u + (c.x - a.x) * v,
        y: a.y + (b.y - a.y) * u + (c.y - a.y) * v,
      });
    }
    grid.push(rowPoints);
  }
  return grid;
}

export function buildFineMesh(vertices, resolution = 6) {
  const safeResolution = Math.max(1, Math.min(20, Math.round(resolution) || 1));
  const triangles = triangulatePolygon(vertices);
  if (triangles.length === 0) return { vertices: [], triangles: [], resolution: safeResolution };

  const points = [];
  const pointLookup = new Map();
  const meshTriangles = [];

  const addPoint = (point) => {
    const key = `${Math.round(point.x * 1e6)}:${Math.round(point.y * 1e6)}`;
    const existing = pointLookup.get(key);
    if (existing !== undefined) return existing;
    const index = points.length;
    points.push(point);
    pointLookup.set(key, index);
    return index;
  };

  for (const triangle of triangles) {
    const a = vertices[triangle[0]];
    const b = vertices[triangle[1]];
    const c = vertices[triangle[2]];
    const grid = barycentricLattice(a, b, c, safeResolution).map((row) => row.map(addPoint));

    for (let row = 0; row < safeResolution; row += 1) {
      for (let column = 0; column < safeResolution - row; column += 1) {
        const p0 = grid[row][column];
        const p1 = grid[row][column + 1];
        const p2 = grid[row + 1][column];
        meshTriangles.push([p0, p1, p2]);
        if (column + row < safeResolution - 1) {
          const p3 = grid[row + 1][column + 1];
          meshTriangles.push([p1, p3, p2]);
        }
      }
    }
  }

  return { vertices: points, triangles: meshTriangles, resolution: safeResolution };
}

function nearestVertexWeights(point, vertices) {
  const weights = new Array(vertices.length).fill(0);
  let nearest = 0;
  let nearestDistance = Infinity;
  vertices.forEach((vertex, index) => {
    const candidateDistance = distance(point, vertex);
    if (candidateDistance < nearestDistance) {
      nearestDistance = candidateDistance;
      nearest = index;
    }
  });
  weights[nearest] = 1;
  return weights;
}

function normalizeWeightVector(rawWeights) {
  if (rawWeights.length === 0 || rawWeights.some((value) => !Number.isFinite(value))) return null;
  const sum = rawWeights.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || Math.abs(sum) <= 1e-14) return null;
  const normalized = rawWeights.map((value) => value / sum);
  if (normalized.some((value) => !Number.isFinite(value))) return null;
  return normalized;
}

export function meanValueCoordinates(point, cageVertices, options = {}) {
  const count = cageVertices.length;
  if (count < 3) return [];

  const bounds = polygonBounds(cageVertices);
  const scale = Math.max(bounds.width, bounds.height, 1);
  const boundaryEpsilon = options.boundaryEpsilon ?? scale * 1e-9;
  const angleLimit = Math.PI - (options.angleEpsilon ?? 1e-9);

  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const a = cageVertices[index];
    const b = cageVertices[next];
    if (distancePointToSegment(point, a, b) > boundaryEpsilon) continue;
    const t = segmentProjectionParameter(point, a, b);
    const weights = new Array(count).fill(0);
    weights[index] = 1 - t;
    weights[next] = t;
    return normalizeWeightVector(weights) ?? nearestVertexWeights(point, cageVertices);
  }

  const vectors = [];
  const distances = [];

  for (let index = 0; index < count; index += 1) {
    const vector = subtract(cageVertices[index], point);
    vectors.push(vector);
    distances.push(length(vector));
  }

  if (Math.min(...distances) <= boundaryEpsilon) {
    return nearestVertexWeights(point, cageVertices);
  }

  const tangentHalfAngles = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const sine = cross(vectors[index], vectors[next]);
    const cosine = dot(vectors[index], vectors[next]);
    const angle = Math.max(-angleLimit, Math.min(angleLimit, Math.atan2(sine, cosine)));
    tangentHalfAngles.push(Math.tan(angle / 2));
  }

  const rawWeights = [];
  for (let index = 0; index < count; index += 1) {
    const previous = (index - 1 + count) % count;
    const safeDistance = Math.max(distances[index], boundaryEpsilon);
    rawWeights.push((tangentHalfAngles[previous] + tangentHalfAngles[index]) / safeDistance);
  }

  const normalized = normalizeWeightVector(rawWeights);
  if (normalized) return normalized;

  const fallback = barycentricCoordinates(point, cageVertices);
  return fallback ?? nearestVertexWeights(point, cageVertices);
}

export function barycentricCoordinates(point, cageVertices) {
  const triangles = triangulatePolygon(cageVertices);
  for (const triangle of triangles) {
    const a = cageVertices[triangle[0]];
    const b = cageVertices[triangle[1]];
    const c = cageVertices[triangle[2]];
    const area = cross(subtract(b, a), subtract(c, a));
    if (Math.abs(area) <= EPSILON) continue;

    const first = cross(subtract(b, point), subtract(c, point)) / area;
    const second = cross(subtract(c, point), subtract(a, point)) / area;
    const third = 1 - first - second;
    const tolerance = -1e-8;
    if (first < tolerance || second < tolerance || third < tolerance) continue;

    const weights = new Array(cageVertices.length).fill(0);
    weights[triangle[0]] = first;
    weights[triangle[1]] = second;
    weights[triangle[2]] = third;
    return normalizeWeightVector(weights);
  }
  return null;
}

export function weightSums(weights) {
  return weights.map((row) => row.reduce((total, value) => total + value, 0));
}

export function deformPoint(weights, cageVertices) {
  let x = 0;
  let y = 0;
  let sum = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index];
    x += cageVertices[index].x * weight;
    y += cageVertices[index].y * weight;
    sum += weight;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(sum) <= 1e-14) {
    return { x: Number.NaN, y: Number.NaN };
  }
  return { x: x / sum, y: y / sum };
}

export function deformMesh(weights, cageVertices) {
  return weights.map((row) => deformPoint(row, cageVertices));
}
