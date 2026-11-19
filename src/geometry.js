/*
 * Basic 2D geometry primitives used by the reflection solver.
 * UMD wrapper so the same file runs under Node (require) and the
 * browser (file:// script tag), with no build step or modules needed.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Geometry = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const EPS = 1e-9;

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const len = (a) => Math.hypot(a.x, a.y);
  const dist = (a, b) => len(sub(a, b));

  function normalize(a) {
    const l = len(a);
    return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
  }

  function angleOf(a) {
    return Math.atan2(a.y, a.x);
  }

  // Mirror a point across an infinite line through p with direction d.
  function reflectPointLine(point, p, d) {
    const u = normalize(d);
    const v = sub(point, p);
    const proj = add(p, scale(u, dot(v, u)));
    return add(scale(proj, 2), scale(point, -1));
  }

  // Reflect direction d across a line with unit direction u.
  function reflectDirection(d, u) {
    const k = 2 * dot(d, u);
    return sub(scale(u, k), d);
  }

  // Signed parameter t of the projection of point onto line (p, d).
  function lineParam(point, p, d) {
    return dot(sub(point, p), d) / dot(d, d);
  }

  // Intersection of two infinite lines p1+t*d1 and p2+s*d2.
  // Returns {t, s} or null when parallel/coincident.
  function lineLine(p1, d1, p2, d2) {
    const denom = cross(d1, d2);
    if (Math.abs(denom) < EPS) return null;
    const delta = sub(p2, p1);
    return { t: cross(delta, d2) / denom, s: cross(delta, d1) / denom };
  }

  // Intersection of segment a-b with ray from origin along unit dir.
  // Returns {point, t, s} where t is ray distance, s in [0,1] on the
  // segment; returns null when there is no forward intersection.
  function raySegment(origin, dir, a, b) {
    const seg = sub(b, a);
    const hit = lineLine(origin, dir, a, seg);
    if (!hit) return null;
    if (hit.t < -EPS || hit.s < -EPS || hit.s > 1 + EPS) return null;
    return {
      point: add(origin, scale(dir, hit.t)),
      t: hit.t,
      s: hit.s,
    };
  }

  // True when the closed segment a-b intersects segment c-d anywhere.
  function segmentsIntersect(a, b, c, d) {
    const r = sub(b, a);
    const s = sub(d, c);
    const denom = cross(r, s);
    const delta = sub(c, a);
    if (Math.abs(denom) < EPS) {
      if (Math.abs(cross(delta, r)) > EPS) return false;
      const r2 = dot(r, r);
      const t0 = dot(sub(c, a), r) / r2;
      const t1 = dot(sub(d, a), r) / r2;
      return Math.max(0, Math.min(t0, t1)) <= Math.min(1, Math.max(t0, t1)) + EPS;
    }
    const t = cross(delta, s) / denom;
    const u = cross(delta, r) / denom;
    return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS;
  }

  // Distance from point p to segment a-b.
  function pointSegmentDistance(p, a, b) {
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    if (l2 < EPS) return dist(p, a);
    const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
    return dist(p, add(a, scale(ab, t)));
  }

  // Shortest angular difference in radians between two directions.
  function angleBetween(d1, d2) {
    const n1 = normalize(d1);
    const n2 = normalize(d2);
    const c = Math.max(-1, Math.min(1, dot(n1, n2)));
    return Math.acos(c);
  }

  return {
    EPS,
    sub,
    add,
    scale,
    dot,
    cross,
    len,
    dist,
    normalize,
    angleOf,
    reflectPointLine,
    reflectDirection,
    lineParam,
    lineLine,
    raySegment,
    segmentsIntersect,
    pointSegmentDistance,
    angleBetween,
  };
});
