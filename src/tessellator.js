// Adaptive tessellation of bicubic Bezier patches.
//
// Subdivision levels are chosen from SCREEN-SPACE curvature: control
// polygons are projected to pixels and the chord deviation decides how
// many segments each curve needs. Edges and interior are leveled
// independently; the interior grid is anisotropic (nu x nv) and edges
// with fewer segments than the grid are stitched by remapping dropped
// boundary vertices to the nearest kept vertex (geomipmap-style), which
// guarantees no T-junctions inside a patch.
//
// Pure module: no DOM / WebGL dependencies, testable in Node.

import {
  evalCubic,
  evalPatch,
  evalPatchDerivatives,
  boundaryCurves,
} from './bezier.js';

export const MAX_LEVEL = 6; // up to 64 segments per direction

// project: (p3:[x,y,z]) -> [px,py] in screen pixels, or null if behind camera.

// Screen-space flatness of a cubic control polygon, in pixels.
export function screenFlatnessPx(cp, project) {
  const q0 = project(cp[0]);
  const q1 = project(cp[1]);
  const q2 = project(cp[2]);
  const q3 = project(cp[3]);
  if (!q0 || !q1 || !q2 || !q3) return Infinity; // off-screen: be safe
  const dx = q3[0] - q0[0];
  const dy = q3[1] - q0[1];
  const len2 = dx * dx + dy * dy;
  const dist = (q) => {
    if (len2 < 1e-6) return Math.hypot(q[0] - q0[0], q[1] - q0[1]);
    return Math.abs((q[0] - q0[0]) * dy - (q[1] - q0[1]) * dx) / Math.sqrt(len2);
  };
  return Math.max(dist(q1), dist(q2));
}

// Subdivision level (segments = 2^level) needed so the piecewise-linear
// approximation error stays within tolPx. A cubic with control-polygon
// chord flatness f deviates at most ~0.75*f from its chord, and splitting
// into n segments shrinks that by n^2. The 2x safety factor leaves
// headroom for the two parametric directions adding up on a surface and
// for curvature peaks falling between the sampled isoparametric curves.
export function levelForFlatness(flatPx, tolPx) {
  if (!Number.isFinite(flatPx)) return MAX_LEVEL;
  const tol = Math.max(tolPx, 1e-3);
  const n = Math.ceil(Math.sqrt((2 * flatPx) / tol));
  let level = 0;
  while ((1 << level) < n) level++;
  return Math.min(level, MAX_LEVEL);
}

// Control polygon of the isoparametric curve along u at fixed v = v0.
function isoCurveU(ctrl, v0) {
  return [
    evalCubic([ctrl[0][0], ctrl[0][1], ctrl[0][2], ctrl[0][3]], v0),
    evalCubic([ctrl[1][0], ctrl[1][1], ctrl[1][2], ctrl[1][3]], v0),
    evalCubic([ctrl[2][0], ctrl[2][1], ctrl[2][2], ctrl[2][3]], v0),
    evalCubic([ctrl[3][0], ctrl[3][1], ctrl[3][2], ctrl[3][3]], v0),
  ];
}

// Control polygon of the isoparametric curve along v at fixed u = u0.
function isoCurveV(ctrl, u0) {
  return [
    evalCubic([ctrl[0][0], ctrl[1][0], ctrl[2][0], ctrl[3][0]], u0),
    evalCubic([ctrl[0][1], ctrl[1][1], ctrl[2][1], ctrl[3][1]], u0),
    evalCubic([ctrl[0][2], ctrl[1][2], ctrl[2][2], ctrl[3][2]], u0),
    evalCubic([ctrl[0][3], ctrl[1][3], ctrl[2][3], ctrl[3][3]], u0),
  ];
}

// Analyze a patch: requested level for each of the 4 boundary edges plus
// interior levels in u and v. Interior levels come from the flatness of
// actual isoparametric surface curves (exact cubic control polygons),
// not just the control net, so interior curvature is captured faithfully.
// Edge order: 0 = u=0, 1 = u=1 (both run along v), 2 = v=0, 3 = v=1 (along u).
export function analyzePatch(ctrl, project, tolPx) {
  const edges = boundaryCurves(ctrl);
  const edgeLevel = edges.map((cp) =>
    levelForFlatness(screenFlatnessPx(cp, project), tolPx),
  );
  let interiorU = 0;
  let interiorV = 0;
  for (const t of [1 / 6, 1 / 3, 0.5, 2 / 3, 5 / 6]) {
    interiorU = Math.max(
      interiorU,
      levelForFlatness(screenFlatnessPx(isoCurveU(ctrl, t), project), tolPx),
    );
    interiorV = Math.max(
      interiorV,
      levelForFlatness(screenFlatnessPx(isoCurveV(ctrl, t), project), tolPx),
    );
  }
  return { edgeLevel, interiorU, interiorV };
}

// Grid resolution for a patch given its analysis and the NEGOTIATED edge
// levels (edge levels may have been raised by a neighbor).
export function gridSize(analysis, negotiatedEdgeLevel) {
  const e = negotiatedEdgeLevel;
  const lv = Math.max(analysis.interiorV, e[0], e[1]);
  const lu = Math.max(analysis.interiorU, e[2], e[3]);
  return { nu: 1 << lu, nv: 1 << lv };
}

// Remap a boundary index to the nearest kept index for an edge with
// `seg` segments on a grid of `n` cells. Monotone, so strips stay
// fully covered and no T-junction can appear.
function makeEdgeRemap(seg, n) {
  const step = n / seg; // integer, both are powers of two and seg <= n
  if (step === 1) return (k) => k;
  return (k) => {
    const r = k % step;
    if (r === 0) return k;
    const lower = k - r;
    return 2 * r <= step ? lower : lower + step;
  };
}

// Tessellate a patch.
//   ctrl: 4x4 control net
//   nu, nv: interior grid resolution (cells)
//   edgeSegs: [seg(u=0), seg(u=1), seg(v=0), seg(v=1)] negotiated counts
//   project: optional, for screen-space deviation measurement
// Returns { positions, normals, uvs, indices, stats }.
export function tessellatePatch(ctrl, nu, nv, edgeSegs, project = null) {
  const remapU0 = makeEdgeRemap(edgeSegs[0], nv); // u=0 edge runs along v
  const remapU1 = makeEdgeRemap(edgeSegs[1], nv); // u=1 edge runs along v
  const remapV0 = makeEdgeRemap(edgeSegs[2], nu); // v=0 edge runs along u
  const remapV1 = makeEdgeRemap(edgeSegs[3], nu); // v=1 edge runs along u

  const cols = nu + 1;
  const rows = nv + 1;
  const positions = new Float32Array(cols * rows * 3);
  const normals = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);

  const p = [0, 0, 0];
  const du = [0, 0, 0];
  const dv = [0, 0, 0];
  for (let j = 0; j < rows; j++) {
    const v = j / nv;
    for (let i = 0; i < cols; i++) {
      const u = i / nu;
      const idx = j * cols + i;
      evalPatch(ctrl, u, v, p);
      positions[idx * 3] = p[0];
      positions[idx * 3 + 1] = p[1];
      positions[idx * 3 + 2] = p[2];
      evalPatchDerivatives(ctrl, u, v, du, dv);
      let nx = du[1] * dv[2] - du[2] * dv[1];
      let ny = du[2] * dv[0] - du[0] * dv[2];
      let nz = du[0] * dv[1] - du[1] * dv[0];
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-12) {
        nx /= len;
        ny /= len;
        nz /= len;
      } else {
        nx = 0;
        ny = 1;
        nz = 0;
      }
      normals[idx * 3] = nx;
      normals[idx * 3 + 1] = ny;
      normals[idx * 3 + 2] = nz;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  // Remapped vertex id for grid coordinate (i, j).
  const vid = (i, j) => {
    if (j === 0) i = remapV0(i);
    else if (j === nv) i = remapV1(i);
    if (i === 0) j = remapU0(j);
    else if (i === nu) j = remapU1(j);
    return j * cols + i;
  };

  const indices = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = vid(i, j);
      const b = vid(i + 1, j);
      const c = vid(i + 1, j + 1);
      const d = vid(i, j + 1);
      if (a !== b && b !== c && a !== c) indices.push(a, b, c);
      if (a !== c && c !== d && a !== d) indices.push(a, c, d);
    }
  }

  const stats = {
    nu,
    nv,
    edgeSegs: edgeSegs.slice(),
    triangles: indices.length / 3,
    maxDevPx: 0,
    rmsDevPx: 0,
  };
  if (project) {
    measureDeviation(ctrl, positions, uvs, indices, project, stats);
  }
  return { positions, normals, uvs, indices, stats };
}

// 2D distance from a point to a triangle (0 when inside).
function pointTriDist2D(px, py, ax, ay, bx, by, cx, cy) {
  const cross = (x1, y1, x2, y2, x3, y3) =>
    (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  const d1 = cross(ax, ay, bx, by, px, py);
  const d2 = cross(bx, by, cx, cy, px, py);
  const d3 = cross(cx, cy, ax, ay, px, py);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  if (!(hasNeg && hasPos)) return 0;
  const seg = (x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  return Math.min(seg(ax, ay, bx, by), seg(bx, by, cx, cy), seg(cx, cy, ax, ay));
}

// Max / RMS screen-space deviation between the triangulation and the
// true surface. The surface is sampled per grid cell; each sample is
// projected and its GEOMETRIC distance to the nearest projected
// triangle is measured (parametrization differences do not count as
// error, only missing shape does). A screen-space bin grid keeps the
// nearest-triangle query cheap.
function measureDeviation(ctrl, positions, uvs, indices, project, stats) {
  const trueP = [0, 0, 0];
  const nu = stats.nu;
  const nv = stats.nv;

  // Project every vertex once.
  const vertCount = positions.length / 3;
  const proj = new Array(vertCount);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const q = project([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
    proj[i] = q;
    if (q) {
      if (q[0] < minX) minX = q[0];
      if (q[1] < minY) minY = q[1];
      if (q[0] > maxX) maxX = q[0];
      if (q[1] > maxY) maxY = q[1];
    }
  }
  if (!Number.isFinite(minX)) return;

  // Bin triangles into a uniform screen-space grid.
  const BINS = 24;
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const bins = new Map();
  const binKey = (bx, by) => bx * 4096 + by;
  const triCount = indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const q0 = proj[indices[t * 3]];
    const q1 = proj[indices[t * 3 + 1]];
    const q2 = proj[indices[t * 3 + 2]];
    if (!q0 || !q1 || !q2) continue;
    const x0 = Math.min(q0[0], q1[0], q2[0]);
    const x1 = Math.max(q0[0], q1[0], q2[0]);
    const y0 = Math.min(q0[1], q1[1], q2[1]);
    const y1 = Math.max(q0[1], q1[1], q2[1]);
    const bx0 = Math.max(0, Math.floor(((x0 - minX) / spanX) * BINS));
    const bx1 = Math.min(BINS - 1, Math.floor(((x1 - minX) / spanX) * BINS));
    const by0 = Math.max(0, Math.floor(((y0 - minY) / spanY) * BINS));
    const by1 = Math.min(BINS - 1, Math.floor(((y1 - minY) / spanY) * BINS));
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const k = binKey(bx, by);
        let arr = bins.get(k);
        if (!arr) bins.set(k, (arr = []));
        arr.push(t);
      }
    }
  }

  const distToTri = (px, py, t) => {
    const q0 = proj[indices[t * 3]];
    const q1 = proj[indices[t * 3 + 1]];
    const q2 = proj[indices[t * 3 + 2]];
    return pointTriDist2D(px, py, q0[0], q0[1], q1[0], q1[1], q2[0], q2[1]);
  };

  const nearestDist = (px, py) => {
    const bx = Math.max(0, Math.min(BINS - 1, Math.floor(((px - minX) / spanX) * BINS)));
    const by = Math.max(0, Math.min(BINS - 1, Math.floor(((py - minY) / spanY) * BINS)));
    let best = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = bins.get(binKey(bx + dx, by + dy));
        if (!arr) continue;
        for (const t of arr) {
          const d = distToTri(px, py, t);
          if (d < best) best = d;
        }
      }
    }
    if (!Number.isFinite(best)) {
      // Rare: nothing nearby (far outside the silhouette). Fall back.
      for (let t = 0; t < triCount; t++) {
        const q0 = proj[indices[t * 3]];
        const q1 = proj[indices[t * 3 + 1]];
        const q2 = proj[indices[t * 3 + 2]];
        if (!q0 || !q1 || !q2) continue;
        const d = distToTri(px, py, t);
        if (d < best) best = d;
      }
    }
    return best;
  };

  let maxDev = 0;
  let sumSq = 0;
  let count = 0;
  const offsets = [
    [0.5, 0.5],
    [0.25, 0.75],
    [0.75, 0.25],
  ];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      for (const [ou, ov] of offsets) {
        const u = (i + ou) / nu;
        const v = (j + ov) / nv;
      evalPatch(ctrl, u, v, trueP);
      const qt = project(trueP);
      if (!qt) continue;
      const d = nearestDist(qt[0], qt[1]);
      if (d > maxDev) maxDev = d;
      sumSq += d * d;
      count++;
      }
    }
  }
  stats.maxDevPx = maxDev;
  stats.rmsDevPx = count > 0 ? Math.sqrt(sumSq / count) : 0;
}

// Kept boundary vertex positions along an edge, in edge-parameter order.
// Used to verify that two patches sharing an edge produce identical
// boundary vertices (no T-junction / crack across patches).
export function boundaryVertices(ctrl, nu, nv, edgeSegs, edge) {
  const out = [];
  const p = [0, 0, 0];
  if (edge === 0 || edge === 1) {
    const seg = edgeSegs[edge];
    const u = edge === 0 ? 0 : 1;
    for (let k = 0; k <= seg; k++) {
      evalPatch(ctrl, u, k / seg, p);
      out.push([p[0], p[1], p[2]]);
    }
  } else {
    const seg = edgeSegs[edge];
    const v = edge === 2 ? 0 : 1;
    for (let k = 0; k <= seg; k++) {
      evalPatch(ctrl, k / seg, v, p);
      out.push([p[0], p[1], p[2]]);
    }
  }
  return out;
}
