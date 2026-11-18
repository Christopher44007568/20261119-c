/**
 * Planar straight-skeleton wavefront for inward polygon offsets.
 *
 * The polygon is normalized to counter-clockwise order. Every source edge
 * moves inward at unit speed. A wavefront edge is therefore the support line
 * n . x = b + t, where n is the source edge's inward unit normal.
 */

export const DEFAULT_TOLERANCE = 1e-5;
export const MIN_TOLERANCE = 1e-8;
export const MAX_TOLERANCE = 1e-2;

const EPS = 1e-12;
const MAX_EVENT_GROUPS = 512;

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function mul(a, scale) {
  return { x: a.x * scale, y: a.y * scale };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function length(a) {
  return Math.hypot(a.x, a.y);
}

export function distance(a, b) {
  return length(sub(a, b));
}

export function normalize(a) {
  const len = length(a);
  if (len <= EPS) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

export function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function boundingBox(points) {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function polygonScale(points) {
  const box = boundingBox(points);
  return Math.max(1, Math.hypot(box.maxX - box.minX, box.maxY - box.minY));
}

function dedupeRing(points, tolerance) {
  const ring = [];
  for (const point of points) {
    if (!ring.length || distance(ring[ring.length - 1], point) > tolerance) {
      ring.push({ x: point.x, y: point.y });
    }
  }
  if (ring.length > 1 && distance(ring[0], ring[ring.length - 1]) <= tolerance) {
    ring.pop();
  }
  return ring;
}

function collinearAmount(previous, point, next) {
  const chord = sub(next, previous);
  const chordLength = length(chord);
  if (chordLength <= EPS) return Infinity;
  return Math.abs(cross(chord, sub(point, previous))) / chordLength;
}

export function normalizePolygon(input, tolerance = DEFAULT_TOLERANCE) {
  const cleanTolerance = Math.min(MAX_TOLERANCE, Math.max(MIN_TOLERANCE, tolerance));
  let ring = dedupeRing(input, cleanTolerance);
  let area = signedArea(ring);
  if (area < 0) {
    ring = ring.slice().reverse();
    area = -area;
  }
  if (ring.length >= 3) {
    validateSimplePolygon(ring, cleanTolerance);
  }

  let removedCollinear = 0;
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    for (let i = 0; i < ring.length; i += 1) {
      const previous = ring[(i - 1 + ring.length) % ring.length];
      const point = ring[i];
      const next = ring[(i + 1) % ring.length];
      if (collinearAmount(previous, point, next) <= cleanTolerance) {
        ring.splice(i, 1);
        removedCollinear += 1;
        changed = true;
        break;
      }
    }
  }

  ring = dedupeRing(ring, cleanTolerance);
  if (ring.length < 3 || signedArea(ring) <= cleanTolerance * cleanTolerance) {
    throw new Error("多边形面积过小或有效顶点不足 3 个。");
  }
  return {
    vertices: ring,
    area: signedArea(ring),
    tolerance: cleanTolerance,
    removedCollinear,
  };
}

function orientation(a, b, c, tolerance) {
  const value = cross(sub(b, a), sub(c, a));
  const scale = Math.max(distance(a, b), distance(b, c), distance(c, a), 1);
  if (Math.abs(value) <= tolerance * scale) return 0;
  return value > 0 ? 1 : -1;
}

function pointOnSegment(a, b, point, tolerance) {
  if (orientation(a, b, point, tolerance) !== 0) return false;
  return (
    point.x >= Math.min(a.x, b.x) - tolerance &&
    point.x <= Math.max(a.x, b.x) + tolerance &&
    point.y >= Math.min(a.y, b.y) - tolerance &&
    point.y <= Math.max(a.y, b.y) + tolerance
  );
}

export function segmentsIntersect(a, b, c, d, tolerance = DEFAULT_TOLERANCE) {
  const o1 = orientation(a, b, c, tolerance);
  const o2 = orientation(a, b, d, tolerance);
  const o3 = orientation(c, d, a, tolerance);
  const o4 = orientation(c, d, b, tolerance);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(a, b, c, tolerance)) return true;
  if (o2 === 0 && pointOnSegment(a, b, d, tolerance)) return true;
  if (o3 === 0 && pointOnSegment(c, d, a, tolerance)) return true;
  if (o4 === 0 && pointOnSegment(c, d, b, tolerance)) return true;
  return false;
}

export function findSelfIntersections(points, tolerance = DEFAULT_TOLERANCE) {
  const intersections = [];
  const count = points.length;
  if (count < 4) return intersections;
  for (let i = 0; i < count; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % count];
    for (let j = i + 1; j < count; j += 1) {
      if (i === j) continue;
      const adjacent =
        (i + 1) % count === j || (j + 1) % count === i;
      if (adjacent) continue;
      const c = points[j];
      const d = points[(j + 1) % count];
      if (segmentsIntersect(a, b, c, d, tolerance)) {
        intersections.push([i, j]);
      }
    }
  }
  return intersections;
}

export function validateSimplePolygon(points, tolerance = DEFAULT_TOLERANCE) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error("至少需要 3 个顶点。");
  }
  const intersections = findSelfIntersections(points, tolerance);
  if (intersections.length) {
    throw new Error(
      `多边形不能自交（边 ${intersections[0][0]} 与边 ${intersections[0][1]} 相交）。`,
    );
  }
  return true;
}

function lineForEdge(edge, time) {
  return { n: edge.normal, b: edge.offset + time };
}

function intersectLines(lineA, lineB) {
  const determinant = cross(lineA.n, lineB.n);
  if (Math.abs(determinant) <= EPS) return null;
  return {
    x: (lineA.b * lineB.n.y - lineB.b * lineA.n.y) / determinant,
    y: (lineA.n.x * lineB.b - lineB.n.x * lineA.b) / determinant,
  };
}

function lineVelocity(lineA, lineB) {
  const determinant = cross(lineA.n, lineB.n);
  if (Math.abs(determinant) <= EPS) return null;
  return {
    x: (lineB.n.y - lineA.n.y) / determinant,
    y: (lineA.n.x - lineB.n.x) / determinant,
  };
}

function makeEdges(vertices) {
  return vertices.map((start, index) => {
    const end = vertices[(index + 1) % vertices.length];
    const direction = normalize(sub(end, start));
    const normal = { x: -direction.y, y: direction.x };
    return {
      id: index,
      start,
      end,
      direction,
      normal,
      offset: dot(normal, start),
      length: distance(start, end),
    };
  });
}

function cycleVertices(cycle, edges, time) {
  const count = cycle.edgeIds.length;
  return cycle.edgeIds.map((edgeId, index) => {
    const previous = edges[cycle.edgeIds[(index - 1 + count) % count]];
    return intersectLines(lineForEdge(previous, time), lineForEdge(edges[edgeId], time));
  });
}

function cycleAreaAt(cycle, edges, time) {
  const vertices = cycleVertices(cycle, edges, time);
  if (vertices.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return 0;
  }
  return Math.abs(signedArea(vertices));
}

function vertexMotion(cycle, edges, vertexIndex) {
  const count = cycle.edgeIds.length;
  const previous = edges[cycle.edgeIds[(vertexIndex - 1 + count) % count]];
  const next = edges[cycle.edgeIds[vertexIndex]];
  return lineVelocity(lineForEdge(previous, 0), lineForEdge(next, 0));
}

function collectCycleEvents(cycle, cycleIndex, edges, time, tolerance, timeTolerance) {
  const events = [];
  const count = cycle.edgeIds.length;
  if (count < 3) return events;
  const vertices = cycleVertices(cycle, edges, time);
  if (vertices.some((point) => !point)) return events;

  for (let position = 0; position < count; position += 1) {
    const edge = edges[cycle.edgeIds[position]];
    const nextPosition = (position + 1) % count;
    const start = vertices[position];
    const end = vertices[nextPosition];
    const startMotion = vertexMotion(cycle, edges, position);
    const endMotion = vertexMotion(cycle, edges, nextPosition);
    if (!startMotion || !endMotion) continue;

    const lengthNow = dot(sub(end, start), edge.direction);
    const lengthRate = dot(sub(endMotion, startMotion), edge.direction);
    if (Math.abs(lengthRate) <= EPS) continue;
    const delta = -lengthNow / lengthRate;
    if (!Number.isFinite(delta) || delta <= timeTolerance) continue;

    const eventStart = add(start, mul(startMotion, delta));
    const eventEnd = add(end, mul(endMotion, delta));
    if (distance(eventStart, eventEnd) > tolerance * 4) continue;
    events.push({
      kind: "edge-collapse",
      cycleIndex,
      edgeId: edge.id,
      edgePosition: position,
      vertexPosition: position,
      point: mul(add(eventStart, eventEnd), 0.5),
      delta,
      incidentEdgeIds: [edge.id, edges[cycle.edgeIds[nextPosition]].id],
    });
  }

  for (let vertexPosition = 0; vertexPosition < count; vertexPosition += 1) {
    const previousPosition = (vertexPosition - 1 + count) % count;
    const previousEdge = edges[cycle.edgeIds[previousPosition]];
    const nextEdge = edges[cycle.edgeIds[vertexPosition]];
    const turn = cross(previousEdge.direction, nextEdge.direction);
    if (turn >= -1e-9) continue;
    const point = vertices[vertexPosition];
    const motion = vertexMotion(cycle, edges, vertexPosition);
    if (!motion) continue;

    for (let edgePosition = 0; edgePosition < count; edgePosition += 1) {
      const incident =
        edgePosition === vertexPosition || edgePosition === previousPosition;
      if (incident) continue;
      const edge = edges[cycle.edgeIds[edgePosition]];
      const denominator = dot(edge.normal, motion) - 1;
      if (Math.abs(denominator) <= EPS) continue;
      const delta =
        (edge.offset + time - dot(edge.normal, point)) / denominator;
      if (!Number.isFinite(delta) || delta <= timeTolerance) continue;

      const collision = add(point, mul(motion, delta));
      const edgeEndPosition = (edgePosition + 1) % count;
      const edgeStart = add(vertices[edgePosition], mul(
        vertexMotion(cycle, edges, edgePosition),
        delta,
      ));
      const edgeEnd = add(vertices[edgeEndPosition], mul(
        vertexMotion(cycle, edges, edgeEndPosition),
        delta,
      ));
      const edgeLength = dot(sub(edgeEnd, edgeStart), edge.direction);
      if (edgeLength <= tolerance) continue;
      const parameter = dot(sub(collision, edgeStart), edge.direction) / edgeLength;
      const parameterTolerance = Math.max(1e-7, tolerance / Math.max(edgeLength, 1));
      if (parameter <= parameterTolerance || parameter >= 1 - parameterTolerance) {
        continue;
      }

      events.push({
        kind: "split",
        cycleIndex,
        edgeId: edge.id,
        edgePosition,
        vertexPosition,
        point: collision,
        delta,
        parameter,
        incidentEdgeIds: [previousEdge.id, nextEdge.id],
      });
    }
  }

  for (let first = 0; first < count; first += 1) {
    for (let second = first + 1; second < count; second += 1) {
      const adjacent =
        (first + 1) % count === second || (second + 1) % count === first;
      if (adjacent) continue;
      const firstMotion = vertexMotion(cycle, edges, first);
      const secondMotion = vertexMotion(cycle, edges, second);
      if (!firstMotion || !secondMotion) continue;
      const relative = sub(vertices[second], vertices[first]);
      const relativeMotion = sub(secondMotion, firstMotion);
      const speedSquared = dot(relativeMotion, relativeMotion);
      if (speedSquared <= EPS) continue;
      const delta = -dot(relative, relativeMotion) / speedSquared;
      if (!Number.isFinite(delta) || delta <= timeTolerance) continue;
      const firstPoint = add(vertices[first], mul(firstMotion, delta));
      const secondPoint = add(vertices[second], mul(secondMotion, delta));
      if (distance(firstPoint, secondPoint) > tolerance * 4) continue;
      events.push({
        kind: "vertex-pinch",
        cycleIndex,
        edgeId: null,
        edgePosition: null,
        vertexPosition: first,
        vertexPositions: [first, second],
        point: mul(add(firstPoint, secondPoint), 0.5),
        delta,
        incidentEdgeIds: [
          edges[cycle.edgeIds[(first - 1 + count) % count]].id,
          edges[cycle.edgeIds[first]].id,
          edges[cycle.edgeIds[(second - 1 + count) % count]].id,
          edges[cycle.edgeIds[second]].id,
        ],
      });
    }
  }
  return events;
}

function eventKey(event) {
  if (event.kind === "edge-collapse") {
    return `edge:${event.cycleIndex}:${event.edgeId}`;
  }
  if (event.kind === "vertex-pinch") {
    return `pinch:${event.cycleIndex}:${event.vertexPositions.join(",")}`;
  }
  return `split:${event.cycleIndex}:${event.edgeId}:${event.incidentEdgeIds.join(",")}`;
}

function collectEvents(cycles, edges, time, tolerance) {
  const seen = new Set();
  const events = [];
  const timeTolerance = Math.max(1e-10, tolerance * 1e-3);
  for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex += 1) {
    const candidates = collectCycleEvents(
      cycles[cycleIndex],
      cycleIndex,
      edges,
      time,
      tolerance,
      timeTolerance,
    );
    for (const event of candidates) {
      const key = eventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  return { events, timeTolerance };
}

function fragmentTokens(cycle, collapsed, splits, edges, time, tolerance) {
  const count = cycle.edgeIds.length;
  const tokensByPosition = new Map();
  const allTokens = [];

  const cutsByEdge = new Map();
  for (const split of splits) {
    if (collapsed.has(split.edgePosition)) continue;
    if (collapsed.has(split.vertexPosition)) continue;
    if (collapsed.has((split.vertexPosition + 1) % count)) continue;
    const edge = edges[cycle.edgeIds[split.edgePosition]];
    const start = cycleVertices(cycle, edges, time)[split.edgePosition];
    const end = cycleVertices(cycle, edges, time)[(split.edgePosition + 1) % count];
    const edgeLength = dot(sub(end, start), edge.direction);
    if (edgeLength <= tolerance) continue;
    const parameter = Math.max(
      tolerance / edgeLength,
      Math.min(1 - tolerance / edgeLength, split.parameter),
    );
    if (!cutsByEdge.has(split.edgePosition)) cutsByEdge.set(split.edgePosition, []);
    cutsByEdge.get(split.edgePosition).push({ ...split, parameter });
  }

  for (const cuts of cutsByEdge.values()) {
    cuts.sort((a, b) => a.parameter - b.parameter);
  }

  for (let position = 0; position < count; position += 1) {
    if (collapsed.has(position)) continue;
    const cuts = cutsByEdge.get(position) ?? [];
    const fragmentCount = cuts.length + 1;
    const fragments = [];
    for (let fragmentIndex = 0; fragmentIndex < fragmentCount; fragmentIndex += 1) {
      const token = {
        id: `${position}:${fragmentIndex}`,
        edgePosition: position,
        edgeId: cycle.edgeIds[position],
        fragmentIndex,
        next: null,
      };
      fragments.push(token);
      allTokens.push(token);
    }
    tokensByPosition.set(position, fragments);
  }
  return { tokensByPosition, allTokens, cutsByEdge };
}

function rewireCycle(cycle, collapsed, splits, pinches, edges, time, tolerance) {
  const count = cycle.edgeIds.length;
  const { tokensByPosition, allTokens, cutsByEdge } = fragmentTokens(
    cycle,
    collapsed,
    splits,
    edges,
    time,
    tolerance,
  );
  if (allTokens.length < 3) return [];

  for (let position = 0; position < count; position += 1) {
    if (!tokensByPosition.has(position)) continue;
    let nextPosition = (position + 1) % count;
    let guard = 0;
    while (!tokensByPosition.has(nextPosition) && guard < count) {
      nextPosition = (nextPosition + 1) % count;
      guard += 1;
    }
    if (!tokensByPosition.has(nextPosition)) continue;
    const from = tokensByPosition.get(position).at(-1);
    const to = tokensByPosition.get(nextPosition)[0];
    from.next = to;
  }

  for (const pinch of pinches) {
    const [first, second] = pinch.vertexPositions;
    const firstSource = (first - 1 + count) % count;
    const secondSource = (second - 1 + count) % count;
    if (!tokensByPosition.has(firstSource) || !tokensByPosition.has(second)) continue;
    if (!tokensByPosition.has(secondSource) || !tokensByPosition.has(first)) continue;
    tokensByPosition.get(firstSource).at(-1).next = tokensByPosition.get(second)[0];
    tokensByPosition.get(secondSource).at(-1).next = tokensByPosition.get(first)[0];
  }

  for (const [edgePosition, cuts] of cutsByEdge) {
    const fragments = tokensByPosition.get(edgePosition);
    for (let cutIndex = 0; cutIndex < cuts.length; cutIndex += 1) {
      const split = cuts[cutIndex];
      const sourcePosition = split.vertexPosition;
      const targetPosition = (sourcePosition + 1) % count;
      if (!tokensByPosition.has(sourcePosition)) continue;
      if (!tokensByPosition.has(targetPosition)) continue;

      const sourceEnd = tokensByPosition.get(sourcePosition).at(-1);
      const targetStart = tokensByPosition.get(targetPosition)[0];
      const beforeCut = fragments[cutIndex];
      const afterCut = fragments[cutIndex + 1];
      sourceEnd.next = afterCut;
      beforeCut.next = targetStart;
    }
  }

  const visited = new Set();
  const result = [];
  for (const token of allTokens) {
    if (visited.has(token.id)) continue;
    const edgeIds = [];
    let cursor = token;
    let guard = 0;
    while (cursor && !visited.has(cursor.id) && guard <= allTokens.length + 1) {
      visited.add(cursor.id);
      edgeIds.push(cursor.edgeId);
      cursor = cursor.next;
      guard += 1;
    }
    if (edgeIds.length >= 3) {
      result.push({ edgeIds });
    }
  }
  return result;
}

function applyEventGroup(cycles, group, edges, time, tolerance) {
  const byCycle = new Map();
  for (const event of group) {
    if (!byCycle.has(event.cycleIndex)) {
      byCycle.set(event.cycleIndex, {
        collapsed: new Set(),
        splits: [],
        pinches: [],
      });
    }
    const bucket = byCycle.get(event.cycleIndex);
    if (event.kind === "edge-collapse") {
      bucket.collapsed.add(event.edgePosition);
    } else if (event.kind === "vertex-pinch") {
      bucket.pinches.push(event);
    } else {
      bucket.splits.push(event);
    }
  }

  const nextCycles = [];
  for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex += 1) {
    const bucket = byCycle.get(cycleIndex);
    if (!bucket) {
      nextCycles.push(cycles[cycleIndex]);
      continue;
    }
    nextCycles.push(
      ...rewireCycle(
        cycles[cycleIndex],
        bucket.collapsed,
        bucket.splits,
        bucket.pinches,
        edges,
        time,
        tolerance,
      ),
    );
  }
  return normalizeWavefrontCycles(nextCycles, edges, time, tolerance);
}

function mergeCollinearCycles(cycles, edges, time, tolerance) {
  const merged = [];
  for (const cycle of cycles) {
    const edgeIds = cycle.edgeIds.slice();
    let changed = true;
    while (changed && edgeIds.length > 3) {
      changed = false;
      for (let index = 0; index < edgeIds.length; index += 1) {
        const first = edges[edgeIds[index]];
        const second = edges[edgeIds[(index + 1) % edgeIds.length]];
        const parallel = Math.abs(cross(first.normal, second.normal)) <= 1e-9;
        const sameDirection = dot(first.normal, second.normal) > 0;
        const sameOffset = Math.abs(first.offset - second.offset) <= tolerance;
        if (!parallel || !sameDirection || !sameOffset) continue;
        edgeIds.splice((index + 1) % edgeIds.length, 1);
        changed = true;
        break;
      }
    }
    const candidate = { edgeIds };
    if (
      edgeIds.length >= 3 &&
      cycleAreaAt(candidate, edges, time) > Math.max(tolerance * tolerance, 1e-12)
    ) {
      merged.push(candidate);
    }
  }
  return merged;
}

function normalizeWavefrontCycles(cycles, edges, time, tolerance) {
  let current = mergeCollinearCycles(cycles, edges, time, tolerance);
  for (let pass = 0; pass < 8; pass += 1) {
    let collapsed = false;
    const next = [];
    for (const cycle of current) {
      const edgeIds = cycle.edgeIds.slice();
      if (edgeIds.length < 3) continue;
      const vertices = cycleVertices(cycle, edges, time);
      const remove = [];
      for (let index = 0; index < edgeIds.length; index += 1) {
        const edge = edges[edgeIds[index]];
        const start = vertices[index];
        const end = vertices[(index + 1) % edgeIds.length];
        if (!start || !end) {
          remove.push(index);
          continue;
        }
        const projectedLength = dot(sub(end, start), edge.direction);
        if (projectedLength <= tolerance) remove.push(index);
      }
      if (remove.length) {
        collapsed = true;
        for (const index of remove.sort((a, b) => b - a)) edgeIds.splice(index, 1);
      }
      if (edgeIds.length >= 3) next.push({ edgeIds });
    }
    current = mergeCollinearCycles(next, edges, time, tolerance);
    if (!collapsed) break;
  }
  return current;
}

function groupTitle(group) {
  const splits = group.filter(
    (event) => event.kind === "split" || event.kind === "vertex-pinch",
  ).length;
  const collapses = group.length - splits;
  if (group.length > 1) {
    if (splits && collapses) return "同时事件：分裂与边消失";
    if (splits) return `同时事件：${splits} 个凹顶点分裂`;
    return `同时事件：${collapses} 条边消失`;
  }
  return splits ? "凹顶点分裂" : "边消失";
}

function cloneCycles(cycles) {
  return cycles.map((cycle) => ({ edgeIds: cycle.edgeIds.slice() }));
}

function eventItemsForUi(group, edges) {
  return group.map((event) => {
    if (event.kind === "vertex-pinch") {
      return {
        kind: "split",
        edgeId: null,
        edgeIds: event.incidentEdgeIds,
        point: event.point,
        message: `两个凹顶点相撞（v${event.vertexPositions[0]} / v${event.vertexPositions[1]}），连通颈被夹断`,
      };
    }
    if (event.kind === "split") {
      return {
        kind: "split",
        edgeId: event.edgeId,
        edgeIds: event.incidentEdgeIds,
        point: event.point,
        message: `凹顶点击中边 e${event.edgeId}，轮廓在此一分为二`,
      };
    }
    return {
      kind: "edge-collapse",
      edgeId: event.edgeId,
      edgeIds: [event.edgeId],
      point: event.point,
      message: `边 e${event.edgeId} 长度归零并消失`,
    };
  });
}

function sumCycleArea(cycles, edges, time) {
  return cycles.reduce((total, cycle) => total + cycleAreaAt(cycle, edges, time), 0);
}

export function computeStraightSkeleton(input, options = {}) {
  const tolerance = Math.min(
    MAX_TOLERANCE,
    Math.max(MIN_TOLERANCE, options.tolerance ?? DEFAULT_TOLERANCE),
  );
  const normalized = normalizePolygon(input, tolerance);
  validateSimplePolygon(normalized.vertices, tolerance);
  const edges = makeEdges(normalized.vertices);
  let cycles = [{ edgeIds: edges.map((edge) => edge.id) }];
  let time = 0;
  const events = [];
  const skeletonSegments = [];
  const warnings = [];
  let activeTimeTolerance = Math.max(1e-10, tolerance * 1e-3);

  for (let groupIndex = 0; groupIndex < MAX_EVENT_GROUPS && cycles.length; groupIndex += 1) {
    const collected = collectEvents(cycles, edges, time, tolerance);
    activeTimeTolerance = collected.timeTolerance;
    if (!collected.events.length) {
      if (cycles.some((cycle) => cycle.edgeIds.length >= 3)) {
        warnings.push("事件队列为空，仍有分量存活；请增大容差或检查退化输入。");
      }
      break;
    }

    const earliest = Math.min(...collected.events.map((event) => event.delta));
    const group = collected.events
      .filter(
        (event) =>
          Math.abs(event.delta - earliest) <=
          activeTimeTolerance * Math.max(1, Math.abs(earliest)),
      )
      .sort(
        (a, b) =>
          a.cycleIndex - b.cycleIndex ||
          a.kind.localeCompare(b.kind) ||
          a.edgeId - b.edgeId,
      );
    const eventTime = time + earliest;
    const beforeArea = sumCycleArea(cycles, edges, time);

    for (const cycle of cycles) {
      const count = cycle.edgeIds.length;
      const startVertices = cycleVertices(cycle, edges, time);
      const endVertices = cycleVertices(cycle, edges, eventTime);
      for (let index = 0; index < count; index += 1) {
        const a = startVertices[index];
        const b = endVertices[index];
        if (a && b && distance(a, b) > tolerance * 0.25) {
          skeletonSegments.push({ a, b, eventIndex: events.length });
        }
      }
    }

    const nextCycles = applyEventGroup(cycles, group, edges, eventTime, tolerance);
    const afterArea = sumCycleArea(nextCycles, edges, eventTime);
    const items = eventItemsForUi(group, edges);
    const event = {
      id: events.length,
      time: eventTime,
      delta: earliest,
      title: groupTitle(group),
      type:
        group.length > 1
          ? "simultaneous"
          : group[0].kind === "split" || group[0].kind === "vertex-pinch"
            ? "split"
            : "edge-collapse",
      simultaneous: group.length,
      items,
      componentsBefore: cycles.length,
      componentsAfter: nextCycles.length,
      areaBefore: beforeArea,
      areaAfter: afterArea,
      point: items[0]?.point ?? { x: 0, y: 0 },
      snapshot: cloneCycles(nextCycles),
    };
    if (!nextCycles.length) {
      event.title = group.length > 1 ? `同时事件后轮廓完全消失` : "轮廓完全消失";
    }
    events.push(event);
    cycles = nextCycles;
    time = eventTime;
  }

  if (cycles.length) {
    warnings.push("达到事件数量上限，轮廓未完全消失。");
  }

  const splitCount = events.reduce(
    (count, event) =>
      count + event.items.filter((item) => item.kind === "split").length,
    0,
  );
  const collapseCount = events.reduce(
    (count, event) =>
      count + event.items.filter((item) => item.kind === "edge-collapse").length,
    0,
  );
  const maxSimultaneous = events.reduce(
    (maximum, event) => Math.max(maximum, event.simultaneous),
    0,
  );

  const result = {
    input: input.map((point) => ({ x: point.x, y: point.y })),
    vertices: normalized.vertices,
    edges,
    area: normalized.area,
    tolerance,
    removedCollinear: normalized.removedCollinear,
    events,
    terminalTime: time,
    initialCycles: [{ edgeIds: edges.map((edge) => edge.id) }],
    skeletonSegments,
    warnings,
    stats: {
      eventGroups: events.length,
      splitCount,
      collapseCount,
      maxSimultaneous,
      eventTimeTolerance: activeTimeTolerance,
    },
  };
  result.audit = auditOffsetIntervals(result);
  if (!result.audit.passed) {
    warnings.push("内部区间抽查发现轮廓自交，请检查退化输入。");
  }
  return result;
}

function makeComponent(cycle, edges, time, tolerance) {
  const vertices = cycleVertices(cycle, edges, time);
  if (
    vertices.length < 3 ||
    vertices.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
  ) {
    return null;
  }
  const signed = signedArea(vertices);
  const area = Math.abs(signed);
  if (area <= Math.max(tolerance * tolerance, 1e-12)) return null;
  const ordered = signed < 0 ? vertices.slice().reverse() : vertices;
  let perimeter = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    perimeter += distance(ordered[index], ordered[(index + 1) % ordered.length]);
  }
  const selfIntersections = findSelfIntersections(ordered, tolerance);
  return {
    edgeIds: cycle.edgeIds.slice(),
    vertices: ordered,
    area,
    perimeter,
    selfIntersections,
  };
}

export function getOffsetAt(result, requestedDistance) {
  const distance = Math.max(0, Number(requestedDistance) || 0);
  let activeCycles = cloneCycles(result.initialCycles);
  let activeTime = 0;
  for (const event of result.events) {
    if (event.time > distance + result.stats.eventTimeTolerance) break;
    activeCycles = cloneCycles(event.snapshot);
    activeTime = event.time;
  }
  if (distance > result.terminalTime + result.stats.eventTimeTolerance && !activeCycles.length) {
    activeCycles = [];
  }
  const components = [];
  for (let index = 0; index < activeCycles.length; index += 1) {
    const component = makeComponent(
      activeCycles[index],
      result.edges,
      distance,
      result.tolerance,
    );
    if (component) {
      components.push({
        id: `component-${index}`,
        ...component,
      });
    }
  }
  return {
    distance,
    components,
    componentCount: components.length,
    totalArea: components.reduce((total, component) => total + component.area, 0),
    selfIntersections: components.reduce(
      (total, component) => total + component.selfIntersections.length,
      0,
    ),
    activeSince: activeTime,
    vanished: components.length === 0,
  };
}

function auditOffsetIntervals(result) {
  const samples = [];
  const times = [0, ...result.events.map((event) => event.time)];
  for (let index = 0; index < times.length - 1; index += 1) {
    const start = times[index];
    const end = times[index + 1];
    if (end - start <= result.stats.eventTimeTolerance) continue;
    const midpoint = (start + end) / 2;
    const offset = getOffsetAt(result, midpoint);
    samples.push({
      time: midpoint,
      components: offset.componentCount,
      area: offset.totalArea,
      selfIntersections: offset.selfIntersections,
    });
  }
  return {
    passed: samples.every((sample) => sample.selfIntersections === 0),
    samples,
  };
}

