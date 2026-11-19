const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/geometry.js");
const S = require("../src/solver.js");
const SC = require("./scenarios.js");

test("coarse sampling misses exact paths; dense sampling recovers them", () => {
  const scene = SC.parallelMirrors();
  const coarse = S.sampleAngles(scene, 2, 36, 0.15);
  const fine = S.sampleAngles(scene, 2, 3600, 0.15);
  assert.ok(coarse.matchedExact < coarse.exactCount, "coarse grid has misses");
  assert.equal(fine.matchedExact, fine.exactCount, "fine grid finds every exact path");
  assert.equal(fine.missedExact, 0);
});

test("recovered paths monotonically improve with sampling density", () => {
  const scene = SC.rightAngle();
  const densities = [72, 360, 1800];
  const matched = densities.map((n) =>
    S.sampleAngles(scene, 2, n, 0.12).matchedExact);
  for (let i = 1; i < matched.length; i++) {
    assert.ok(matched[i] >= matched[i - 1]);
  }
  assert.equal(matched[matched.length - 1],
    S.enumeratePaths(scene, 2).valid.length);
});

test("forward ray trace obeys the reflection law at each bounce", () => {
  const scene = SC.parallelMirrors();
  // Aim the ray along an exact enumerated two-bounce path.
  const exact = S.enumeratePaths(scene, 2).valid.find((p) => p.bounces === 2);
  const initialDir = G.normalize(G.sub(exact.points[1], exact.points[0]));
  const trace = S.traceRay(scene, initialDir, 2, 0.15);
  assert.equal(trace.status, "reached");
  assert.ok(trace.bounces >= 1);
  for (let i = 1; i < trace.points.length - 1; i++) {
    const point = trace.points[i];
    const mirror = scene.mirrors[trace.bounceMirrors[i - 1]];
    assert.ok(mirror, "bounce point sits on a mirror");
    const u = G.normalize(G.sub(mirror.b, mirror.a));
    const travelIn = G.normalize(G.sub(point, trace.points[i - 1]));
    const outgoing = G.normalize(G.sub(trace.points[i + 1], point));
    const err = G.angleBetween(G.reflectDirection(travelIn, u), outgoing);
    assert.ok(err < 1e-7, `law error ${err} above noise floor`);
  }
});

test("sampling never reports a path absent from exact enumeration", () => {
  const scene = SC.singleMirror();
  const sampling = S.sampleAngles(scene, 1, 720, 0.12);
  assert.ok(sampling.matchedExact <= sampling.exactCount);
});

test("occluded scene: no sampled ray reaches the receiver directly", () => {
  const scene = SC.occludedDirect();
  const sampling = S.sampleAngles(scene, 1, 1440, 0.1);
  const directHits = sampling.rays.filter(
    (r) => r.trace.status === "reached" && r.trace.bounces === 0);
  assert.equal(directHits.length, 0);
});
