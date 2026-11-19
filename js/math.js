export const EPSILON = 1e-9;

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function mul(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function lengthSq(a) {
  return dot(a, a);
}

export function length(a) {
  return Math.sqrt(lengthSq(a));
}

export function distanceSq(a, b) {
  return lengthSq(sub(a, b));
}

export function normalize(a, fallback = [0, 0, 1]) {
  const len = length(a);
  return len > EPSILON ? mul(a, 1 / len) : [...fallback];
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerp3(a, b, t) {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function triangleBounds(triangle) {
  return {
    min: [
      Math.min(triangle.a[0], triangle.b[0], triangle.c[0]),
      Math.min(triangle.a[1], triangle.b[1], triangle.c[1]),
      Math.min(triangle.a[2], triangle.b[2], triangle.c[2]),
    ],
    max: [
      Math.max(triangle.a[0], triangle.b[0], triangle.c[0]),
      Math.max(triangle.a[1], triangle.b[1], triangle.c[1]),
      Math.max(triangle.a[2], triangle.b[2], triangle.c[2]),
    ],
  };
}

export function triangleCentroid(triangle) {
  return [
    (triangle.a[0] + triangle.b[0] + triangle.c[0]) / 3,
    (triangle.a[1] + triangle.b[1] + triangle.c[1]) / 3,
    (triangle.a[2] + triangle.b[2] + triangle.c[2]) / 3,
  ];
}

export function rayTriangle(origin, direction, triangle, maxT = Infinity) {
  const edge1 = sub(triangle.b, triangle.a);
  const edge2 = sub(triangle.c, triangle.a);
  const h = cross(direction, edge2);
  const determinant = dot(edge1, h);

  if (Math.abs(determinant) < 1e-10) return null;

  const inverse = 1 / determinant;
  const offset = sub(origin, triangle.a);
  const u = dot(offset, h) * inverse;
  if (u < -1e-7 || u > 1 + 1e-7) return null;

  const q = cross(offset, edge1);
  const v = dot(direction, q) * inverse;
  if (v < -1e-7 || u + v > 1 + 1e-7) return null;

  const t = dot(edge2, q) * inverse;
  if (t <= 1e-6 || t > maxT) return null;

  return { t, u, v, w: 1 - u - v };
}

export function closestPointOnTriangle(point, triangle) {
  const { a, b, c } = triangle;
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(point, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);

  if (d1 <= 0 && d2 <= 0) {
    return { point: [...a], distanceSq: distanceSq(point, a), u: 0, v: 0, w: 1 };
  }

  const bp = sub(point, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) {
    return { point: [...b], distanceSq: distanceSq(point, b), u: 1, v: 0, w: 0 };
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const projected = add(a, mul(ab, v));
    return {
      point: projected,
      distanceSq: distanceSq(point, projected),
      u: v,
      v: 0,
      w: 1 - v,
    };
  }

  const cp = sub(point, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) {
    return { point: [...c], distanceSq: distanceSq(point, c), u: 0, v: 1, w: 0 };
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const projected = add(a, mul(ac, w));
    return {
      point: projected,
      distanceSq: distanceSq(point, projected),
      u: 0,
      v: w,
      w: 1 - w,
    };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const projected = add(b, mul(sub(c, b), w));
    return {
      point: projected,
      distanceSq: distanceSq(point, projected),
      u: 1 - w,
      v: w,
      w: 0,
    };
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  const projected = add(a, add(mul(ab, v), mul(ac, w)));
  return {
    point: projected,
    distanceSq: distanceSq(point, projected),
    u: v,
    v: w,
    w: 1 - v - w,
  };
}

export function interpolateVertexNormal(triangle, barycentric) {
  const { u, v, w } = barycentric;
  return normalize([
    triangle.na[0] * w + triangle.nb[0] * u + triangle.nc[0] * v,
    triangle.na[1] * w + triangle.nb[1] * u + triangle.nc[1] * v,
    triangle.na[2] * w + triangle.nb[2] * u + triangle.nc[2] * v,
  ]);
}

function expandBounds(bounds, other) {
  for (let axis = 0; axis < 3; axis += 1) {
    bounds.min[axis] = Math.min(bounds.min[axis], other.min[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], other.max[axis]);
  }
}

function buildNode(triangles, indices, depth) {
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  let centroidMin = [Infinity, Infinity, Infinity];
  let centroidMax = [-Infinity, -Infinity, -Infinity];
  let centroidSum = [0, 0, 0];

  for (const index of indices) {
    const triangle = triangles[index];
    expandBounds(bounds, triangle.bounds);
    for (let axis = 0; axis < 3; axis += 1) {
      centroidMin[axis] = Math.min(centroidMin[axis], triangle.centroid[axis]);
      centroidMax[axis] = Math.max(centroidMax[axis], triangle.centroid[axis]);
      centroidSum[axis] += triangle.centroid[axis];
    }
  }

  if (indices.length <= 8 || depth >= 18) {
    return { bounds, indices: [...indices], left: null, right: null };
  }

  const extents = [
    centroidMax[0] - centroidMin[0],
    centroidMax[1] - centroidMin[1],
    centroidMax[2] - centroidMin[2],
  ];
  let axis = 0;
  if (extents[1] > extents[axis]) axis = 1;
  if (extents[2] > extents[axis]) axis = 2;

  const centroid = mul(centroidSum, 1 / indices.length);
  const sorted = [...indices].sort(
    (a, b) => triangles[a].centroid[axis] - triangles[b].centroid[axis],
  );
  const middle = sorted.length >> 1;

  if (
    triangles[sorted[0]].centroid[axis] ===
    triangles[sorted[sorted.length - 1]].centroid[axis]
  ) {
    return { bounds, indices: sorted, left: null, right: null };
  }

  return {
    bounds,
    indices: null,
    splitAxis: axis,
    splitValue: centroid[axis],
    left: buildNode(triangles, sorted.slice(0, middle), depth + 1),
    right: buildNode(triangles, sorted.slice(middle), depth + 1),
  };
}

export function buildBVH(triangles) {
  const indices = triangles.map((_, index) => index);
  return {
    root: buildNode(triangles, indices, 0),
    triangleCount: triangles.length,
  };
}

function rayAABB(origin, inverseDirection, min, max, maxT) {
  let near = 0;
  let far = maxT;

  for (let axis = 0; axis < 3; axis += 1) {
    let t0 = (min[axis] - origin[axis]) * inverseDirection[axis];
    let t1 = (max[axis] - origin[axis]) * inverseDirection[axis];
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (far < near) return false;
  }

  return true;
}

export function intersectBVH(bvh, triangles, origin, direction, maxT = Infinity) {
  const inverseDirection = [
    Math.abs(direction[0]) > EPSILON ? 1 / direction[0] : 1e20,
    Math.abs(direction[1]) > EPSILON ? 1 / direction[1] : 1e20,
    Math.abs(direction[2]) > EPSILON ? 1 / direction[2] : 1e20,
  ];
  const stack = [bvh.root];
  let best = null;

  while (stack.length > 0) {
    const node = stack.pop();
    if (!rayAABB(origin, inverseDirection, node.bounds.min, node.bounds.max, best ? best.t : maxT)) {
      continue;
    }

    if (node.indices) {
      for (const index of node.indices) {
        const hit = rayTriangle(origin, direction, triangles[index], best ? best.t : maxT);
        if (hit && (!best || hit.t < best.t)) {
          best = { ...hit, triangle: triangles[index], triangleIndex: index };
        }
      }
      continue;
    }

    const leftDistance = pointAABBDistanceSq(origin, node.left.bounds);
    const rightDistance = pointAABBDistanceSq(origin, node.right.bounds);
    if (leftDistance < rightDistance) {
      stack.push(node.right, node.left);
    } else {
      stack.push(node.left, node.right);
    }
  }

  return best;
}

export function pointAABBDistanceSq(point, bounds) {
  let total = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta =
      point[axis] < bounds.min[axis]
        ? bounds.min[axis] - point[axis]
        : point[axis] > bounds.max[axis]
          ? point[axis] - bounds.max[axis]
          : 0;
    total += delta * delta;
  }
  return total;
}

export function closestPointBVH(bvh, triangles, point) {
  const stack = [bvh.root];
  let best = null;

  while (stack.length > 0) {
    const node = stack.pop();
    if (best && pointAABBDistanceSq(point, node.bounds) > best.distanceSq) {
      continue;
    }

    if (node.indices) {
      for (const index of node.indices) {
        const closest = closestPointOnTriangle(point, triangles[index]);
        if (!best || closest.distanceSq < best.distanceSq) {
          best = {
            ...closest,
            triangle: triangles[index],
            triangleIndex: index,
          };
        }
      }
      continue;
    }

    const leftDistance = pointAABBDistanceSq(point, node.left.bounds);
    const rightDistance = pointAABBDistanceSq(point, node.right.bounds);
    if (leftDistance < rightDistance) {
      stack.push(node.right, node.left);
    } else {
      stack.push(node.left, node.right);
    }
  }

  return best;
}
