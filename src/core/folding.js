// Rigid-fold kinematics.
//
// A crease pattern is:
//   { vertices: [[x, y], ...],
//     panels:   [{ id, vertices: [vertexIndex, ...] }],
//     folds:    [{ id, panels: [idA, idB], edge: [i, j],
//                  assignment: 'M' | 'V' }] }
//
// Panels are RIGID bodies: each gets a 3D rigid transform (rotation +
// translation). No panel vertex is ever stretched; only dihedral angles at
// hinge folds change.

import {
  add,
  applyXf,
  composeXf,
  identityTransform,
  matVec,
  normalize,
  rotMatrix,
  sub,
  v3,
} from '../math/vec3.js';
import {
  edgeKey,
  polygonEdges,
  trianglesIntersect,
  triangulate,
} from '../math/geometry.js';

const ANGLE_TOL = 0.5 * (Math.PI / 180);

function localPoint(vertex2d) {
  return v3(vertex2d[0], vertex2d[1], 0);
}

// Signed rotation for a fold. Theta is the non-negative fold amount in
// radians; the M/V assignment picks the rotation sense about the oriented
// hinge edge (edge[0] -> edge[1]).
export function signedFoldAngle(assignment, theta) {
  const amount = Math.abs(theta);
  return assignment === 'M' ? amount : -amount;
}

function patternScale(pattern) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pattern.vertices) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return Math.max(maxX - minX, maxY - minY, 1e-9);
}

// Validate topology: every fold edge must be a boundary edge of both panels,
// and referenced vertices must exist. Returns an error string or null.
export function validatePattern(pattern) {
  const panelById = new Map();
  for (const panel of pattern.panels) panelById.set(panel.id, panel);
  if (panelById.size === 0) return '图案中没有面板';
  for (const panel of pattern.panels) {
    if (panel.vertices.length < 3) return `面板 ${panel.id} 少于 3 个顶点`;
    for (const vi of panel.vertices) {
      if (!pattern.vertices[vi]) return `面板 ${panel.id} 引用了不存在的顶点 ${vi}`;
    }
  }
  for (const fold of pattern.folds) {
    const [idA, idB] = fold.panels;
    const pa = panelById.get(idA);
    const pb = panelById.get(idB);
    if (!pa || !pb) return `折痕 ${fold.id} 引用了不存在的面板`;
    const key = edgeKey(fold.edge[0], fold.edge[1]);
    const hasEdge = (panel) =>
      polygonEdges(panel.vertices).some(([a, b]) => edgeKey(a, b) === key);
    if (!hasEdge(pa) || !hasEdge(pb)) {
      return `折痕 ${fold.id} 的边不是两个相邻面板的共享边`;
    }
    if (fold.assignment !== 'M' && fold.assignment !== 'V') {
      return `折痕 ${fold.id} 的山谷标记必须是 M 或 V`;
    }
  }
  return null;
}

function buildAdjacency(pattern) {
  const adj = new Map();
  for (const panel of pattern.panels) adj.set(panel.id, []);
  for (const fold of pattern.folds) {
    const [idA, idB] = fold.panels;
    adj.get(idA).push({ foldId: fold.id, other: idB });
    adj.get(idB).push({ foldId: fold.id, other: idA });
  }
  return adj;
}

// BFS spanning tree over the panel adjacency graph. Returns traversal order,
// parent links and the list of folds that close cycles.
function spanningTree(pattern, adj) {
  const rootId = pattern.panels[0].id;
  const parent = new Map(); // panelId -> { parentId, foldId }
  const visited = new Set([rootId]);
  const order = [rootId];
  const treeFoldIds = new Set();
  const closureFoldIds = [];
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift();
    for (const link of adj.get(current)) {
      if (treeFoldIds.has(link.foldId)) continue;
      if (visited.has(link.other)) {
        closureFoldIds.push(link.foldId);
        continue;
      }
      visited.add(link.other);
      parent.set(link.other, { parentId: current, foldId: link.foldId });
      treeFoldIds.add(link.foldId);
      order.push(link.other);
      queue.push(link.other);
    }
  }
  return { rootId, order, parent, closureFoldIds: [...new Set(closureFoldIds)] };
}

function foldMap(pattern) {
  const map = new Map();
  for (const fold of pattern.folds) map.set(fold.id, fold);
  return map;
}

function localHinge(pattern, fold) {
  const p0 = pattern.vertices[fold.edge[0]];
  const p1 = pattern.vertices[fold.edge[1]];
  const axis = normalize(sub(localPoint(p1), localPoint(p0)));
  return { origin: localPoint(p0), axis };
}

// Propagate rigid transforms across the spanning tree.
function propagateTransforms(pattern, state, tree, folds) {
  const transforms = new Map();
  transforms.set(tree.rootId, identityTransform());
  for (const panelId of tree.order) {
    if (panelId === tree.rootId) continue;
    const link = tree.parent.get(panelId);
    const fold = folds.get(link.foldId);
    const parentXf = transforms.get(link.parentId);
    const hinge = localHinge(pattern, fold);
    const phi = signedFoldAngle(fold.assignment, state[fold.id] ?? 0);
    const rRel = rotMatrix(hinge.axis, phi);
    // world = parent(origin + Rrel*(q - origin))
    const worldOrigin = applyXf(parentXf, hinge.origin);
    const rWorld = composeXf(parentXf, rRel, v3(0, 0, 0)).R;
    const tWorld = sub(worldOrigin, matVec(rWorld, hinge.origin));
    transforms.set(panelId, { R: rWorld, t: tWorld });
  }
  return transforms;
}

function panelWorldGeometry(pattern, panel, xf) {
  const orderedIds = panel.vertices.slice();
  const original2d = panel.vertices.map((vi) => pattern.vertices[vi]);
  if (signedArea2(original2d) < 0) orderedIds.reverse();
  const local2d = orderedIds.map((vi) => pattern.vertices[vi]);
  const vertexToLocal = new Map(orderedIds.map((vi, i) => [vi, i]));
  const local3d = local2d.map(localPoint);
  const world3d = local3d.map((p) => applyXf(xf, p));
  const tris = triangulate(local2d).map((tri) => tri.map((i) => world3d[i]));
  const normal = (() => {
    const e1 = sub(world3d[1], world3d[0]);
    const e2 = sub(world3d[2], world3d[0]);
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    return normalize(n);
  })();
  const centroid = world3d
    .reduce((acc, p) => add(acc, p), v3(0, 0, 0))
    .map((c) => c / world3d.length);
  return { local2d, local3d, world3d, tris, normal, centroid, vertexToLocal };
}

function signedArea2(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function dihedralFromNormals(nA, nB, axis) {
  // Signed angle from nA to nB about the hinge axis direction.
  const cosA = Math.max(-1, Math.min(1, dot3(nA, nB)));
  let angle = Math.acos(cosA);
  if (dot3(cross3(nA, nB), axis) < 0) angle = -angle;
  return angle;
}

function closureResiduals(pattern, state, tree, folds, geometry) {
  const results = [];
  for (const foldId of tree.closureFoldIds) {
    const fold = folds.get(foldId);
    const [idA, idB] = fold.panels;
    const ga = geometry.get(idA);
    const gb = geometry.get(idB);
    const va = fold.edge.map((vi) => {
      return ga.world3d[ga.vertexToLocal.get(vi)];
    });
    const vb = fold.edge.map((vi) => {
      return gb.world3d[gb.vertexToLocal.get(vi)];
    });
    const d0 = norm3(sub(va[0], vb[0]));
    const d1 = norm3(sub(va[1], vb[1]));
    const axis = normalize(sub(va[1], va[0]));
    const observed = dihedralFromNormals(ga.normal, gb.normal, axis);
    const target = signedFoldAngle(fold.assignment, state[fold.id] ?? 0);
    let angleResidual = observed - target;
    angleResidual = Math.atan2(Math.sin(angleResidual), Math.cos(angleResidual));
    results.push({
      foldId,
      positionResidual: Math.max(d0, d1),
      angleResidual: Math.abs(angleResidual),
    });
  }
  return results;
}

// Every 2D panel edge must keep its length after folding (rigid panels and
// rigid hinges). Returns the maximum relative length change.
function edgeLengthCheck(pattern, geometry) {
  let maxRelative = 0;
  let worst = null;
  for (const panel of pattern.panels) {
    const g = geometry.get(panel.id);
    for (const [a, b] of polygonEdges(panel.vertices)) {
      const before = norm3(
        sub(localPoint(pattern.vertices[a]), localPoint(pattern.vertices[b])),
      );
      const after = norm3(
        sub(g.world3d[g.vertexToLocal.get(a)], g.world3d[g.vertexToLocal.get(b)]),
      );
      const rel = Math.abs(after - before) / Math.max(before, 1e-12);
      if (rel > maxRelative) {
        maxRelative = rel;
        worst = { panelId: panel.id, edge: [a, b], before, after };
      }
    }
  }
  return { maxRelative, worst };
}

function intersectionCheck(pattern, folds, geometry) {
  // Folds are exactly the adjacency edges; adjacent panels only meet along
  // their shared hinge for fold amounts <= pi, so they are skipped here.
  const adjacentPairs = new Set();
  for (const fold of pattern.folds) {
    adjacentPairs.add(edgeKey(fold.panels[0], fold.panels[1]));
  }
  const violations = [];
  const panels = pattern.panels;
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      if (adjacentPairs.has(edgeKey(panels[i].id, panels[j].id))) continue;
      const ga = geometry.get(panels[i].id);
      const gb = geometry.get(panels[j].id);
      for (const ta of ga.tris) {
        for (const tb of gb.tris) {
          if (trianglesIntersect(ta, tb)) {
            violations.push({ panels: [panels[i].id, panels[j].id] });
            break;
          }
        }
        if (violations.some((v) => v.panels[0] === panels[i].id && v.panels[1] === panels[j].id)) break;
      }
    }
  }
  return violations;
}

export function solveFold(pattern, state, options = {}) {
  const error = validatePattern(pattern);
  if (error) return { ok: false, error };
  const scale = patternScale(pattern);
  const posTol = options.positionTolerance ?? scale * 1e-4;
  const angleTol = options.angleTolerance ?? ANGLE_TOL;
  const folds = foldMap(pattern);
  const adj = buildAdjacency(pattern);
  const tree = spanningTree(pattern, adj);
  const transforms = propagateTransforms(pattern, state, tree, folds);

  const geometry = new Map();
  for (const panel of pattern.panels) {
    geometry.set(panel.id, panelWorldGeometry(pattern, panel, transforms.get(panel.id)));
  }

  const closure = closureResiduals(pattern, state, tree, folds, geometry);
  const lengths = edgeLengthCheck(pattern, geometry);
  const intersections = intersectionCheck(pattern, folds, geometry);
  const closureFailed = closure.some(
    (c) => c.positionResidual > posTol || c.angleResidual > angleTol,
  );
  const lengthFailed = lengths.maxRelative > (options.lengthTolerance ?? 1e-6);
  const accepted = !closureFailed && !lengthFailed && intersections.length === 0;
  return {
    ok: true,
    tree,
    transforms,
    geometry,
    closure,
    lengths,
    intersections,
    accepted,
    reasons: [
      ...(closureFailed ? ['闭环约束残差超差'] : []),
      ...(lengthFailed ? ['面板边长发生变化（非刚体）'] : []),
      ...(intersections.length ? ['非相邻面板互相穿透'] : []),
    ],
    posTol,
    angleTol,
    scale,
  };
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}
