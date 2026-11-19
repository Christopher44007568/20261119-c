// Path construction, angular velocity and continuity diagnostics.

import { normalize } from "./quat.js";
import { toAxisAngle, clamp } from "./convert.js";
import {
  slerp, eulerLerp, squadControls, squadSegment, shortArcDelta, logQ
} from "./interp.js";

// Canonicalize user keys: copy, sort by time, merge zero-duration duplicates.
export function prepareKeys(keys) {
  const sorted = keys.map((k) => ({
    t: k.t,
    q: normalize(k.q),
    e: Array.isArray(k.e) ? k.e.slice() : undefined
  }))
    .sort((a, b) => a.t - b.t);
  const out = [];
  for (const k of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(k.t - prev.t) < 1e-12) {
      prev.q = k.q; // repeated pose at the same time: later one wins
      prev.e = k.e;
    } else {
      out.push(k);
    }
  }
  return out;
}

// Locate the segment containing time t. Returns { i, u }.
export function locate(keys, t) {
  if (t <= keys[0].t) return { i: 0, u: 0 };
  const last = keys.length - 1;
  if (t >= keys[last].t) return { i: last - 1, u: 1 };
  for (let i = 0; i < last; i++) {
    if (t <= keys[i + 1].t) {
      const span = keys[i + 1].t - keys[i].t;
      return { i, u: span < 1e-12 ? 0 : (t - keys[i].t) / span };
    }
  }
  return { i: last - 1, u: 1 };
}

export function buildPath(method, rawKeys) {
  const keys = prepareKeys(rawKeys);
  const controls = method === "squad" ? squadControls(keys) : null;
  return {
    method,
    keys,
    controls,
    at(t) {
      if (keys.length === 1) return keys[0].q.clone();
      const hit = keys.find((k) => Math.abs(k.t - t) < 1e-12);
      if (hit) return hit.q.clone();
      const { i, u } = locate(keys, t);
      const a = keys[i];
      const b = keys[i + 1];
      if (method === "euler") return eulerLerp(a.q, b.q, u, a.e, b.e);
      if (method === "slerp") return slerp(a.q, b.q, u);
      return squadSegment(a.q, b.q, controls[i], controls[i + 1], u);
    }
  };
}

// Angular velocity vector from two unit quaternions separated by dt.
// omega = 2/dt * log(q2 * q1^-1), short arc (delta w >= 0).
export function angularVelocity(q1, q2, dt) {
  if (dt < 1e-12) return [0, 0, 0];
  const delta = shortArcDelta(q1, q2);
  const lv = logQ(delta);
  return [(2 / dt) * lv[0], (2 / dt) * lv[1], (2 / dt) * lv[2]];
}

function vecLen(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// Uniform sample stream across [t0, tN] with frame count n.
export function sampleFrames(path, n) {
  const t0 = path.keys[0].t;
  const t1 = path.keys[path.keys.length - 1].t;
  const frames = [];
  for (let k = 0; k < n; k++) {
    const u = n === 1 ? 0 : k / (n - 1);
    const t = t0 + (t1 - t0) * u;
    frames.push({ t, q: path.at(t) });
  }
  return frames;
}

// Per-frame angular velocity via central differences (one-sided at ends).
export function frameVelocities(frames) {
  return frames.map((f, k) => {
    const prev = frames[Math.max(0, k - 1)];
    const next = frames[Math.min(frames.length - 1, k + 1)];
    const dt = next.t - prev.t;
    const w = angularVelocity(prev.q, next.q, dt);
    return { t: f.t, omega: w, speed: vecLen(w) };
  });
}

// One-sided velocities at every interior key, and the jump across the joint.
export function jointJumps(path) {
  const keys = path.keys;
  const rows = [];
  for (let i = 1; i < keys.length - 1; i++) {
    const t = keys[i].t;
    // Scale the probe to the local spacing so short segments are not
    // overshot by a fixed absolute epsilon.
    const dtL = Math.max(t - keys[i - 1].t, 1e-9);
    const dtR = Math.max(keys[i + 1].t - t, 1e-9);
    const hL = Math.min(dtL, dtR) * 1e-3;
    const hR = hL;
    const qL = path.at(t - hL);
    const qC = path.at(t);
    const qR = path.at(t + hR);
    const wL = angularVelocity(qL, qC, hL);
    const wR = angularVelocity(qC, qR, hR);
    const jump = sub(wR, wL);
    rows.push({
      index: i,
      t,
      wLeft: wL,
      wRight: wR,
      jump,
      jumpMag: vecLen(jump),
      speedLeft: vecLen(wL),
      speedRight: vecLen(wR)
    });
  }
  return rows;
}

// Analytic constant angular velocity of a short-arc slerp segment.
export function slerpSegmentVelocity(a, b, dt) {
  const delta = shortArcDelta(a, b);
  const { axis, angle } = toAxisAngle(delta);
  if (dt < 1e-12) return [0, 0, 0];
  const k = angle / dt;
  return [axis[0] * k, axis[1] * k, axis[2] * k];
}

// Accumulate actual traveled rotation angle per segment with dense samples.
// A segment is flagged when its traveled angle exceeds pi, i.e. the path
// winds more than a half turn instead of staying on the declared short arc.
// For curved squad paths the geodesic chord is expected to be shorter; that
// is geometric bending, not winding, and is reported separately.
export function fullTurnAudit(path, samplesPerSegment = 200) {
  const keys = path.keys;
  const segments = [];
  let totalExcess = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    let traveled = 0;
    let prev = keys[i].q;
    for (let k = 1; k <= samplesPerSegment; k++) {
      const u = k / samplesPerSegment;
      const cur = path.at(keys[i].t + (keys[i + 1].t - keys[i].t) * u);
      const delta = shortArcDelta(prev, cur);
      const step = toAxisAngle(delta).angle;
      traveled += step;
      prev = cur;
    }
    const geodesic = toAxisAngle(shortArcDelta(keys[i].q, keys[i + 1].q)).angle;
    const excess = traveled - geodesic;
    totalExcess += excess;
    // slerp must stay on the geodesic arc (<= pi). squad may bend, so its
    // winding threshold is the chord plus a full revolution.
    const limit = path.method === "squad" ? geodesic + 2 * Math.PI : Math.PI;
    segments.push({
      i,
      geodesic,
      traveled,
      excess,
      fullTurn: traveled > limit + 1e-6
    });
  }
  return { segments, totalExcess, anyFullTurn: segments.some((s) => s.fullTurn) };
}

export { clamp };
