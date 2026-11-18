// Translates solveFold output into flat position/color arrays for the
// WebGL renderer and builds hinge-axis / panel-normal gizmos.

const PANEL_COLOR = [0.62, 0.78, 0.92];
const PANEL_EDGE = [0.16, 0.22, 0.3];
const MOUNTAIN = [0.9, 0.25, 0.2];
const VALLEY = [0.2, 0.45, 0.95];
const INTERSECT = [1.0, 0.12, 0.12];
const HINGE_GIZMO = [1.0, 0.75, 0.15];
const NORMAL_GIZMO = [0.25, 0.95, 0.55];

function pushVertex(arrays, point, color) {
  arrays.positions.push(point[0], point[1], point[2]);
  arrays.colors.push(color[0], color[1], color[2]);
}

function pushLine(arrays, a, b, color) {
  pushVertex(arrays, a, color);
  pushVertex(arrays, b, color);
}

function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 1];
}

function addArrow(arrays, origin, direction, length, color, head = 0.08) {
  const dir = normalize(direction);
  const tip = origin.map((c, i) => c + dir[i] * length);
  pushLine(arrays, origin, tip, color);
  const ref = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const side = normalize([
    dir[1] * ref[2] - dir[2] * ref[1],
    dir[2] * ref[0] - dir[0] * ref[2],
    dir[0] * ref[1] - dir[1] * ref[0],
  ]);
  const up = [
    dir[1] * side[2] - dir[2] * side[1],
    dir[2] * side[0] - dir[0] * side[2],
    dir[0] * side[1] - dir[1] * side[0],
  ];
  const base = tip.map((c, i) => c - dir[i] * head);
  for (const s of [side, up, [-side[0], -side[1], -side[2]], [-up[0], -up[1], -up[2]]]) {
    const conePoint = base.map((c, i) => c + s[i] * head * 0.55);
    pushLine(arrays, tip, conePoint, color);
  }
}

export function buildScene(pattern, result, options = {}) {
  const fill = { positions: [], colors: [], normals: [] };
  const lines = { positions: [], colors: [] };
  const intersectingPanels = new Set();
  for (const violation of result.intersections) {
    violation.panels.forEach((id) => intersectingPanels.add(id));
  }

  for (const panel of pattern.panels) {
    const g = result.geometry.get(panel.id);
    const faceColor = intersectingPanels.has(panel.id) ? INTERSECT : PANEL_COLOR;
    for (const tri of g.tris) {
      const triNormal = triangleNormal(tri);
      for (const point of tri) {
        pushVertex(fill, point, faceColor);
        fill.normals.push(triNormal[0], triNormal[1], triNormal[2]);
      }
    }
    for (let i = 0; i < g.world3d.length; i++) {
      const a = g.world3d[i];
      const b = g.world3d[(i + 1) % g.world3d.length];
      pushLine(lines, a, b, PANEL_EDGE);
    }
  }

  for (const fold of pattern.folds) {
    const [idA] = fold.panels;
    const g = result.geometry.get(idA);
    const color = fold.assignment === 'M' ? MOUNTAIN : VALLEY;
    const p0 = g.world3d[g.vertexToLocal.get(fold.edge[0])];
    const p1 = g.world3d[g.vertexToLocal.get(fold.edge[1])];
    pushLine(lines, p0, p1, color);
  }

  if (options.activeFoldId) {
    const fold = pattern.folds.find((f) => f.id === options.activeFoldId);
    if (fold) {
      const g = result.geometry.get(fold.panels[0]);
      const p0 = g.world3d[g.vertexToLocal.get(fold.edge[0])];
      const p1 = g.world3d[g.vertexToLocal.get(fold.edge[1])];
      const axis = normalize([
        p1[0] - p0[0],
        p1[1] - p0[1],
        p1[2] - p0[2],
      ]);
      const mid = p0.map((c, i) => (c + p1[i]) / 2);
      const extent = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      const start = mid.map((c, i) => c - axis[i] * extent * 0.7);
      const end = mid.map((c, i) => c + axis[i] * extent * 0.7);
      pushLine(lines, start, end, HINGE_GIZMO);
      addArrow(lines, mid, axis, extent * 0.55, HINGE_GIZMO);
    }
  }

  if (options.showNormals) {
    for (const panel of pattern.panels) {
      const g = result.geometry.get(panel.id);
      addArrow(lines, g.centroid, g.normal, 0.45, NORMAL_GIZMO);
    }
  }

  return { fill, lines };
}

function triangleNormal(tri) {
  const a = tri[0];
  const b = tri[1];
  const c = tri[2];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return normalize([
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]);
}
