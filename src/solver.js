/*
 * Specular reflection path solver.
 *
 * Exact enumeration uses the method of images ("unfolding"): for every
 * ordered sequence of mirrors up to maxBounces, reflect the receiver and
 * the remaining mirror lines across each unfolded mirror, then intersect
 * the straight source -> unfolded-receiver line with every unfolded line.
 * Each candidate is folded back and verified against:
 *   1. finite mirror segment boundaries,
 *   2. occluder / non-intended mirror blocking on every leg,
 *   3. the reflection law (incidence angle == reflection angle).
 */
(function (root, factory) {
  const api = factory(
    typeof require === "function" ? require("./geometry.js") : root.Geometry
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Solver = api;
  }
})(typeof self !== "undefined" ? self : this, function (G) {
  "use strict";

  const BOUNDS_TOL = 1e-7;
  const LAW_TOL = 1e-6; // numerical noise floor; measured error is still reported
  const DEDUP_DIGITS = 6;

  function mirrorId(m, i) {
    return m.id != null ? String(m.id) : "M" + i;
  }

  function occluderId(o, i) {
    return o.id != null ? String(o.id) : "O" + i;
  }

  function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += G.dist(points[i - 1], points[i]);
    return total;
  }

  // Reflect an infinite line {p, d} across another infinite line.
  function reflectLine(line, across) {
    const u = G.normalize(across.d);
    return {
      p: G.reflectPointLine(line.p, across.p, u),
      d: G.reflectDirection(line.d, u),
    };
  }

  function onSegment(point, mirror) {
    const d = G.sub(mirror.b, mirror.a);
    const t = G.lineParam(point, mirror.a, d);
    return t >= -BOUNDS_TOL && t <= 1 + BOUNDS_TOL &&
      G.pointSegmentDistance(point, mirror.a, mirror.b) <= BOUNDS_TOL;
  }

  // Interior intersection of leg (a,b) with segment (segStart,segEnd).
  // Endpoint touches are allowed (they are intended reflection points or
  // shared junctions); a strict interior hit means the leg is blocked.
  function interiorBlocker(a, b, segStart, segEnd) {
    const leg = G.sub(b, a);
    const seg = G.sub(segEnd, segStart);
    const denom = G.cross(leg, seg);
    if (Math.abs(denom) < BOUNDS_TOL) {
      if (!G.segmentsIntersect(a, b, segStart, segEnd)) return null;
      // Collinear overlap with a positive-length interior portion blocks.
      const leg2 = G.dot(leg, leg);
      const t0 = G.dot(G.sub(segStart, a), leg) / leg2;
      const t1 = G.dot(G.sub(segEnd, a), leg) / leg2;
      const lo = Math.max(0, Math.min(t0, t1));
      const hi = Math.min(1, Math.max(t0, t1));
      if (hi - lo <= BOUNDS_TOL) return null;
      return { point: G.add(a, G.scale(leg, (lo + hi) / 2)), t: (lo + hi) / 2 };
    }
    const t = G.cross(G.sub(segStart, a), seg) / denom;
    const u = G.cross(G.sub(segStart, a), leg) / denom;
    if (t <= BOUNDS_TOL || t >= 1 - BOUNDS_TOL) return null;
    if (u < -BOUNDS_TOL || u > 1 + BOUNDS_TOL) return null;
    return { point: G.add(a, G.scale(leg, t)), t };
  }

  // Build the folded polyline for an ordered mirror sequence, or return a
  // rejection descriptor {reason, detail} when the unfolding cannot work.
  function buildCandidate(scene, sequence) {
    const source = scene.source;
    const receiver = scene.receiver;
    const mirrors = scene.mirrors;

    // Stage k (1..k): unfolded line of the k-th mirror. At every step the
    // next room (including its mirror line and the receiver) is reflected
    // across the previously unfolded mirror line.
    const unfoldedLines = [];
    let currentReceiver = receiver;

    for (let k = 0; k < sequence.length; k++) {
      const mirror = mirrors[sequence[k]];
      const baseLine = { p: mirror.a, d: G.sub(mirror.b, mirror.a) };
      const line = k === 0
        ? baseLine
        : reflectLine(baseLine, unfoldedLines[k - 1]);
      unfoldedLines.push(line);
      currentReceiver = G.reflectPointLine(currentReceiver, line.p, line.d);
    }

    const rayDir = G.sub(currentReceiver, source);
    if (G.len(rayDir) < BOUNDS_TOL) {
      return { reason: "degenerate", detail: "unfolded receiver coincides with source" };
    }

    // Intersect source->unfolded receiver against every unfolded mirror line.
    const unfoldedHits = [];
    let lastParam = 0;
    for (let k = 0; k < unfoldedLines.length; k++) {
      const hit = G.lineLine(source, rayDir, unfoldedLines[k].p, unfoldedLines[k].d);
      if (!hit) {
        return { reason: "unfold_miss", detail: "parallel unfolded mirror line" };
      }
      if (hit.t <= lastParam + BOUNDS_TOL) {
        return { reason: "unfold_order", detail: "unfolded intersections not strictly ordered" };
      }
      unfoldedHits.push(hit.t);
      lastParam = hit.t;
    }
    if (lastParam >= 1 - BOUNDS_TOL) {
      return { reason: "unfold_order", detail: "last intersection not before unfolded receiver" };
    }

    // Fold each hit point back through R[k], R[k-1], ..., R[1].
    const reflectionPoints = [];
    for (let k = 0; k < unfoldedHits.length; k++) {
      let point = G.add(source, G.scale(rayDir, unfoldedHits[k]));
      for (let j = k; j >= 0; j--) {
        point = G.reflectPointLine(point, unfoldedLines[j].p, unfoldedLines[j].d);
      }
      reflectionPoints.push(point);
    }

    const points = [source, ...reflectionPoints, receiver];
    return { points, sequence };
  }

  // Verify a folded polyline: finite boundaries, occlusion, reflection law.
  function validateCandidate(scene, candidate) {
    const mirrors = scene.mirrors;
    const occluders = scene.occluders || [];
    const { points, sequence } = candidate;

    for (let k = 0; k < sequence.length; k++) {
      const point = points[k + 1];
      if (!onSegment(point, mirrors[sequence[k]])) {
        return {
          reason: "outside_segment",
          detail: "reflection point outside finite mirror " +
            mirrorId(mirrors[sequence[k]], sequence[k]),
          rejectedPoint: point,
          mirrorIndex: sequence[k],
        };
      }
    }

    for (let leg = 0; leg < points.length - 1; leg++) {
      const a = points[leg];
      const b = points[leg + 1];
      for (let i = 0; i < occluders.length; i++) {
        const hit = interiorBlocker(a, b, occluders[i].a, occluders[i].b);
        if (hit) {
          return {
            reason: "occluded",
            detail: "leg blocked by occluder " + occluderId(occluders[i], i),
            rejectedPoint: hit.point,
          };
        }
      }
      for (let i = 0; i < mirrors.length; i++) {
        const intended = leg < sequence.length ? sequence[leg] : -1;
        if (i === intended) continue; // hit at the leg endpoint, allowed
        const hit = interiorBlocker(a, b, mirrors[i].a, mirrors[i].b);
        if (hit) {
          return {
            reason: "blocked_by_mirror",
            detail: "leg strikes mirror " + mirrorId(mirrors[i], i) + " before its target",
            rejectedPoint: hit.point,
            mirrorIndex: i,
          };
        }
      }
    }

    const angleErrors = [];
    for (let k = 0; k < sequence.length; k++) {
      const point = points[k + 1];
      const mirror = mirrors[sequence[k]];
      const u = G.normalize(G.sub(mirror.b, mirror.a));
      const incoming = G.normalize(G.sub(point, points[k])); // toward surface
      const outgoing = G.normalize(G.sub(points[k + 2], point));
      const reflected = G.reflectDirection(incoming, u);
      const err = G.angleBetween(reflected, outgoing);
      angleErrors.push(err);
      if (err > LAW_TOL) {
        return {
          reason: "law_violation",
          detail: "incidence/reflection angle mismatch on mirror " +
            mirrorId(mirror, sequence[k]),
          angleError: err,
        };
      }
    }

    return { ok: true, angleErrors };
  }

  function dedupKey(points) {
    return points
      .map((p) => `${p.x.toFixed(DEDUP_DIGITS)},${p.y.toFixed(DEDUP_DIGITS)}`)
      .join("|");
  }

  function directPath(scene) {
    const { source, receiver, mirrors, occluders = [] } = scene;
    for (let i = 0; i < occluders.length; i++) {
      const hit = interiorBlocker(source, receiver, occluders[i].a, occluders[i].b);
      if (hit) {
        return {
          valid: [],
          rejected: [{
            sequence: [],
            points: [source, receiver],
            reason: "occluded",
            detail: "direct line blocked by occluder " + occluderId(occluders[i], i),
            rejectedPoint: hit.point,
          }],
        };
      }
    }
    for (let i = 0; i < mirrors.length; i++) {
      const hit = interiorBlocker(source, receiver, mirrors[i].a, mirrors[i].b);
      if (hit) {
        return {
          valid: [],
          rejected: [{
            sequence: [],
            points: [source, receiver],
            reason: "blocked_by_mirror",
            detail: "direct line crosses mirror " + mirrorId(mirrors[i], i),
            rejectedPoint: hit.point,
          }],
        };
      }
    }
    return {
      valid: [{
        sequence: [],
        points: [source, receiver],
        length: G.dist(source, receiver),
        angleErrors: [],
        maxAngleError: 0,
        bounces: 0,
      }],
      rejected: [],
    };
  }

  // Exhaustive enumeration of every ordered mirror sequence up to
  // maxBounces, folded, verified, deduplicated by geometric polyline.
  function enumeratePaths(scene, maxBounces) {
    const mirrors = scene.mirrors;
    const result = directPath(scene);
    const seen = new Map();
    for (const path of result.valid) seen.set(dedupKey(path.points), path);

    function visit(sequence) {
      const built = buildCandidate(scene, sequence);
      if (built.reason) {
        result.rejected.push({
          sequence: sequence.slice(),
          points: null,
          reason: built.reason,
          detail: built.detail,
        });
        return;
      }
      const verdict = validateCandidate(scene, built);
      if (!verdict.ok) {
        result.rejected.push({
          sequence: sequence.slice(),
          points: built.points,
          reason: verdict.reason,
          detail: verdict.detail,
          rejectedPoint: verdict.rejectedPoint || null,
          mirrorIndex: verdict.mirrorIndex ?? null,
        });
        return;
      }
      const key = dedupKey(built.points);
      if (seen.has(key)) {
        result.duplicates = (result.duplicates || 0) + 1;
        return;
      }
      const path = {
        sequence: sequence.slice(),
        points: built.points,
        length: pathLength(built.points),
        angleErrors: verdict.angleErrors,
        maxAngleError: Math.max(0, ...verdict.angleErrors),
        bounces: sequence.length,
      };
      seen.set(key, path);
      result.valid.push(path);
    }

    (function dfs(prefix) {
      if (prefix.length >= maxBounces) return;
      for (let i = 0; i < mirrors.length; i++) {
        // Back-to-back reflection on the same mirror is physically
        // degenerate and never yields a new path; skip it.
        if (prefix.length && prefix[prefix.length - 1] === i) continue;
        const next = prefix.concat(i);
        visit(next);
        dfs(next);
      }
    })([]);

    result.valid.sort((a, b) => a.length - b.length || a.bounces - b.bounces);
    result.counts = countReasons(result.rejected);
    return result;
  }

  function countReasons(rejected) {
    const counts = {};
    for (const item of rejected) counts[item.reason] = (counts[item.reason] || 0) + 1;
    return counts;
  }

  // Forward ray trace with physical reflections. Stops when the ray passes
  // within receiverRadius of the receiver (before any nearer obstruction).
  // status: "reached" | "escaped" | "max_bounces".
  function traceRay(scene, initialDir, maxBounces, receiverRadius) {
    const { source, receiver, mirrors, occluders = [] } = scene;
    const points = [source];
    const bounceMirrors = [];
    const angleErrors = [];
    let origin = source;
    let dir = G.normalize(initialDir);
    let length = 0;
    const SELF_HIT = 1e-5; // ignore re-intersection with the surface just left

    for (let bounce = 0; bounce <= maxBounces; bounce++) {
      let nearest = null;
      for (let i = 0; i < mirrors.length; i++) {
        const hit = G.raySegment(origin, dir, mirrors[i].a, mirrors[i].b);
        if (hit && hit.t > SELF_HIT && (!nearest || hit.t < nearest.t)) {
          nearest = { ...hit, kind: "mirror", index: i };
        }
      }
      for (let i = 0; i < occluders.length; i++) {
        const hit = G.raySegment(origin, dir, occluders[i].a, occluders[i].b);
        if (hit && hit.t > SELF_HIT && (!nearest || hit.t < nearest.t)) {
          nearest = { ...hit, kind: "occluder", index: i };
        }
      }

      const receiverDist = G.pointSegmentDistance(receiver, origin,
        G.add(origin, G.scale(dir, nearest ? nearest.t : 1e9)));
      const receiverT = G.dot(G.sub(receiver, origin), dir);
      if (receiverT > SELF_HIT && receiverDist <= receiverRadius &&
          (!nearest || receiverT <= nearest.t + BOUNDS_TOL)) {
        points.push(receiver);
        length += receiverT;
        return {
          status: "reached",
          points,
          bounceMirrors,
          bounces: bounce,
          length,
          maxAngleError: Math.max(0, ...angleErrors),
        };
      }

      if (!nearest) {
        points.push(G.add(origin, G.scale(dir, 1e6)));
        return { status: "escaped", points, bounces: bounce };
      }
      if (nearest.kind === "occluder") {
        points.push(nearest.point);
        return { status: "blocked", points, bounces: bounce };
      }

      const mirror = mirrors[nearest.index];
      const u = G.normalize(G.sub(mirror.b, mirror.a));
      points.push(nearest.point);
      bounceMirrors.push(nearest.index);
      length += nearest.t;
      dir = G.normalize(G.reflectDirection(dir, u));
      angleErrors.push(0); // forward trace applies the law exactly
      origin = nearest.point;
    }
    points.push(G.add(origin, G.scale(dir, 1e6)));
    return { status: "max_bounces", points, maxBounces, angleErrors, bounceMirrors };
  }

  // Dense uniform angular sampling; reports how many distinct exact paths
  // each sampling density manages to rediscover.
  function sampleAngles(scene, maxBounces, sampleCount, receiverRadius) {
    const exact = enumeratePaths(scene, maxBounces);
    const rays = [];
    const reached = [];
    const matched = new Set();

    for (let i = 0; i < sampleCount; i++) {
      const theta = (i / sampleCount) * 2 * Math.PI;
      const dir = { x: Math.cos(theta), y: Math.sin(theta) };
      const trace = traceRay(scene, dir, maxBounces, receiverRadius);
      rays.push({ theta, dir, trace });
      if (trace.status === "reached") {
        reached.push(trace);
        for (const path of exact.valid) {
          if (path.bounces !== trace.bounces) continue;
          if (polylinesClose(path.points, trace.points, receiverRadius)) {
            matched.add(dedupKey(path.points));
          }
        }
      }
    }

    return {
      sampleCount,
      receiverRadius,
      rays,
      reachedCount: reached.length,
      exactCount: exact.valid.length,
      matchedExact: matched.size,
      missedExact: exact.valid.length - matched.size,
      angularResolution: 360 / sampleCount,
    };
  }

  function polylinesClose(a, b, tol) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (G.dist(a[i], b[i]) > tol) return false;
    }
    return true;
  }

  return {
    enumeratePaths,
    traceRay,
    sampleAngles,
    pathLength,
    buildCandidate,
    validateCandidate,
    onSegment,
    BOUNDS_TOL,
    LAW_TOL,
  };
});
