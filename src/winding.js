import { vec, vertexAt, TAU } from "./geometry.js";

const EPSILON = 1e-12;

function closestPointOnSegment(point, a, b) {
  const ab = vec.sub(b, a);
  const denominator = vec.dot(ab, ab);
  if (denominator <= EPSILON) return a.slice();
  const t = Math.max(0, Math.min(1, vec.dot(vec.sub(point, a), ab) / denominator));
  return vec.add(a, vec.scale(ab, t));
}

export function closestPointOnTriangle(point, a, b, c) {
  const ab = vec.sub(b, a);
  const ac = vec.sub(c, a);
  const normal = vec.cross(ab, ac);
  if (vec.dot(normal, normal) <= EPSILON) {
    const candidates = [
      closestPointOnSegment(point, a, b),
      closestPointOnSegment(point, b, c),
      closestPointOnSegment(point, c, a),
    ];
    let best = candidates[0];
    let bestDistance = vec.length(vec.sub(point, best));
    for (let i = 1; i < candidates.length; i += 1) {
      const distance = vec.length(vec.sub(point, candidates[i]));
      if (distance < bestDistance) {
        best = candidates[i];
        bestDistance = distance;
      }
    }
    return { point: best, distance: bestDistance };
  }

  const ap = vec.sub(point, a);
  const d1 = vec.dot(ab, ap);
  const d2 = vec.dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { point: [a[0], a[1], a[2]], distance: vec.length(ap) };

  const bp = vec.sub(point, b);
  const d3 = vec.dot(ab, bp);
  const d4 = vec.dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) {
    return { point: [b[0], b[1], b[2]], distance: vec.length(vec.sub(point, b)) };
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    const closest = vec.add(a, vec.scale(ab, t));
    return { point: closest, distance: vec.length(vec.sub(point, closest)) };
  }

  const cp = vec.sub(point, c);
  const d5 = vec.dot(ab, cp);
  const d6 = vec.dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) {
    return { point: [c[0], c[1], c[2]], distance: vec.length(vec.sub(point, c)) };
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    const closest = vec.add(a, vec.scale(ac, t));
    return { point: closest, distance: vec.length(vec.sub(point, closest)) };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const closest = vec.add(b, vec.scale(vec.sub(c, b), t));
    return { point: closest, distance: vec.length(vec.sub(point, closest)) };
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  const closest = vec.add(a, vec.add(vec.scale(ab, v), vec.scale(ac, w)));
  return { point: closest, distance: vec.length(vec.sub(point, closest)) };
}

export function triangleSolidAngle(point, a, b, c) {
  const ax = a[0] - point[0];
  const ay = a[1] - point[1];
  const az = a[2] - point[2];
  const bx = b[0] - point[0];
  const by = b[1] - point[1];
  const bz = b[2] - point[2];
  const cx = c[0] - point[0];
  const cy = c[1] - point[1];
  const cz = c[2] - point[2];

  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  const lc = Math.hypot(cx, cy, cz);
  const numerator = ax * (by * cz - bz * cy)
    + ay * (bz * cx - bx * cz)
    + az * (bx * cy - by * cx);
  const denominator = la * lb * lc
    + (ax * bx + ay * by + az * bz) * lc
    + (bx * cx + by * cy + bz * cz) * la
    + (cx * ax + cy * ay + cz * az) * lb;

  if (Math.abs(numerator) <= Number.EPSILON && Math.abs(denominator) <= Number.EPSILON) {
    return 0;
  }
  return 2 * Math.atan2(numerator, denominator);
}

export function windingNumber(mesh, point) {
  let solidAngle = 0;
  let nearestDistance = Infinity;
  let nearestPoint = null;
  let nearestFace = -1;
  let activeFaces = 0;
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];

  for (let face = 0; face < mesh.removed.length; face += 1) {
    if (mesh.removed[face]) continue;
    activeFaces += 1;
    const offset = face * 3;
    vertexAt(mesh, mesh.faces[offset], a);
    vertexAt(mesh, mesh.faces[offset + 1], b);
    vertexAt(mesh, mesh.faces[offset + 2], c);
    solidAngle += triangleSolidAngle(point, a, b, c);

    const closest = closestPointOnTriangle(point, a, b, c);
    if (closest.distance < nearestDistance) {
      nearestDistance = closest.distance;
      nearestPoint = closest.point;
      nearestFace = face;
    }
  }

  return {
    winding: solidAngle / (4 * Math.PI),
    solidAngle,
    nearestDistance: activeFaces > 0 ? nearestDistance : Infinity,
    nearestPoint,
    nearestFace,
    activeFaces,
  };
}

export function classifyQuery(result, { surfaceEpsilon = 0.008, valueBand = 0.035 } = {}) {
  if (!Number.isFinite(result.nearestDistance)) {
    return {
      kind: "uncertain",
      label: "NO ACTIVE SURFACE",
      detail: "All faces are deleted; W is identically zero.",
      containment: null,
      orientation: null,
    };
  }
  if (result.nearestDistance <= surfaceEpsilon) {
    return {
      kind: "surface",
      label: "SURFACE / BOUNDARY",
      detail: "On or within ε of active geometry. Containment is intentionally undetermined.",
      containment: null,
      orientation: null,
    };
  }

  const magnitude = Math.abs(result.winding);
  if (magnitude >= 0.5 + valueBand) {
    return {
      kind: "inside",
      label: "INSIDE",
      detail: result.winding < 0
        ? "Positive containment with inward face orientation (W < 0)."
        : "Positive containment with outward face orientation (W > 0).",
      containment: true,
      orientation: result.winding < 0 ? "inward" : "outward",
    };
  }
  if (magnitude <= 0.5 - valueBand) {
    return {
      kind: "outside",
      label: "OUTSIDE",
      detail: "Winding magnitude is below the containment threshold.",
      containment: false,
      orientation: null,
    };
  }
  return {
    kind: "uncertain",
    label: "UNCERTAIN / TRANSITION",
    detail: "W is between 0.5 ± value band; this is expected near holes, open sheets, or coarse meshes.",
    containment: null,
    orientation: null,
  };
}

export function spherePointInfo(point, radius = 1, center = [0, 0, 0]) {
  const radiusAtPoint = vec.length(vec.sub(point, center));
  const signedGap = radiusAtPoint - radius;
  return {
    inside: signedGap < 0,
    signedGap,
    radialDistance: radiusAtPoint,
  };
}

export function windingColor(winding) {
  const magnitude = Math.min(1, Math.abs(winding));
  const hue = 187 - 155 * magnitude;
  return `hsl(${hue} ${44 + 34 * magnitude}% ${57 + 10 * magnitude}%)`;
}
