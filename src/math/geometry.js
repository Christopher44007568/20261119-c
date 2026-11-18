// 2D polygon helpers operating on [x, y] point arrays embedded at z = 0.

export function signedArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function ensureCCW(points) {
  return signedArea(points) < 0 ? [...points].reverse() : points.map((p) => [...p]);
}

export function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function polygonEdges(panelVerts) {
  const edges = [];
  for (let i = 0; i < panelVerts.length; i++) {
    edges.push([panelVerts[i], panelVerts[(i + 1) % panelVerts.length]]);
  }
  return edges;
}

function pointInTriangle(p, a, b, c) {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const hasNeg = d1 < -1e-10 || d2 < -1e-10 || d3 < -1e-10;
  const hasPos = d1 > 1e-10 || d2 > 1e-10 || d3 > 1e-10;
  return !(hasNeg && hasPos);
}

// Ear-clipping triangulation of a simple polygon. Returns vertex-index triples
// referencing the supplied polygon order.
export function triangulate(points) {
  const indices = points.map((_, i) => i);
  const tris = [];
  let guard = indices.length * indices.length + 8;
  while (indices.length > 3 && guard-- > 0) {
    let ear = -1;
    for (let i = 0; i < indices.length; i++) {
      const i0 = indices[(i - 1 + indices.length) % indices.length];
      const i1 = indices[i];
      const i2 = indices[(i + 1) % indices.length];
      const a = points[i0];
      const b = points[i1];
      const c = points[i2];
      const cross2 =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross2 <= 1e-12) continue; // reflex or degenerate vertex
      let containsPoint = false;
      for (const j of indices) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTriangle(points[j], a, b, c)) {
          containsPoint = true;
          break;
        }
      }
      if (!containsPoint) {
        ear = i;
        break;
      }
    }
    if (ear < 0) break; // malformed polygon; keep what we have
    const list = indices;
    const i0 = list[(ear - 1 + list.length) % list.length];
    const i1 = list[ear];
    const i2 = list[(ear + 1) % list.length];
    tris.push([i0, i1, i2]);
    list.splice(ear, 1);
  }
  if (indices.length === 3) tris.push([indices[0], indices[1], indices[2]]);
  return tris;
}

// Robust triangle/triangle overlap test.
//
// SAT is used for the generic 3D case, but coplanar triangles are handled
// separately so that two panels merely touching along an edge or a vertex in
// the flat state are not reported as penetrating.
export function trianglesIntersect(a, b, eps = 1e-8) {
  const edgesA = [sub3(a[1], a[0]), sub3(a[2], a[1]), sub3(a[0], a[2])];
  const edgesB = [sub3(b[1], b[0]), sub3(b[2], b[1]), sub3(b[0], b[2])];
  const nA = normalize3(cross3(edgesA[0], edgesA[1]));
  const nB = normalize3(cross3(edgesB[0], edgesB[1]));
  const planesParallel = Math.abs(dot3(nA, nB)) > 1 - eps;
  const planeOffset = dot3(nA, sub3(b[0], a[0]));
  if (planesParallel) {
    if (Math.abs(planeOffset) > eps) return false; // parallel but separated
    return coplanarTrianglesOverlap(a, b, nA, eps);
  }
  const axes = [nA, nB];
  for (const ea of edgesA) {
    for (const eb of edgesB) {
      const cr = cross3(ea, eb);
      const n = Math.hypot(cr[0], cr[1], cr[2]);
      if (n > eps) axes.push([cr[0] / n, cr[1] / n, cr[2] / n]);
    }
  }
  for (const ax of axes) {
    if (Math.hypot(ax[0], ax[1], ax[2]) < eps) continue;
    const interval = (tri) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of tri) {
        const d = dot3(ax, p);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      return [lo, hi];
    };
    const [loA, hiA] = interval(a);
    const [loB, hiB] = interval(b);
    // A non-negative gap (including exact vertex/edge contact, gap = 0) means
    // the triangle interiors do not cross on this axis. Only a strictly
    // negative gap beyond tolerance can contribute to real penetration.
    if (hiA <= loB + eps || hiB <= loA + eps) return false;
  }
  return true;
}

// Coplanar overlap in 2D: project onto the plane basis and use SAT with the
// triangle edge normals. Edge-only or vertex-only contact stays separated on
// some axis and returns false.
function coplanarTrianglesOverlap(a, b, normal, eps) {
  const ref = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ex = normalize3(cross3(normal, ref));
  const ey = cross3(normal, ex);
  const project = (tri) =>
    tri.map((p) => [dot3(ex, p), dot3(ey, p)]);
  const pa = project(a);
  const pb = project(b);
  const edges = [
    [pa[0], pa[1]],
    [pa[1], pa[2]],
    [pa[2], pa[0]],
    [pb[0], pb[1]],
    [pb[1], pb[2]],
    [pb[2], pb[0]],
  ];
  for (const [p, q] of edges) {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const axis = [-dy, dx];
    const n = Math.hypot(axis[0], axis[1]);
    if (n < eps) continue;
    axis[0] /= n;
    axis[1] /= n;
    const valsA = pa.map((pt) => pt[0] * axis[0] + pt[1] * axis[1]);
    const valsB = pb.map((pt) => pt[0] * axis[0] + pt[1] * axis[1]);
    const minA = Math.min(...valsA);
    const maxA = Math.max(...valsA);
    const minB = Math.min(...valsB);
    const maxB = Math.max(...valsB);
    // Touching only at a vertex/edge (overlap depth within eps) is contact,
    // not penetration of one panel interior through another.
    if (maxA <= minB + eps || maxB <= minA + eps) return false;
  }
  return true;
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normalize3(a) {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}
