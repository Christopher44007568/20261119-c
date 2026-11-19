const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/geometry.js");
const S = require("../src/solver.js");
const SC = require("./scenarios.js");

const LAW_BUDGET = 1e-6; // radians

function run(factory) {
  const scene = factory();
  const result = S.enumeratePaths(scene, scene.maxBounces);
  return { scene, result };
}

test("single mirror: direct + one reflected path, law verified", () => {
  const { result } = run(SC.singleMirror);
  assert.equal(result.valid.length, 2);
  assert.deepEqual(result.valid.map((p) => p.bounces), [0, 1]);
  const reflected = result.valid.find((p) => p.bounces === 1);
  assert.ok(reflected.maxAngleError < LAW_BUDGET);
  assert.ok(Math.abs(reflected.length - Math.sqrt(18)) < 1e-9);
  // reflection point lies on the finite segment
  const hit = reflected.points[1];
  assert.ok(hit.x >= -5 && hit.x <= 5 && Math.abs(hit.y) < 1e-9);
});

test("parallel mirrors: path count grows with bounce budget", () => {
  const scene = SC.parallelMirrors();
  const counts = [1, 2, 3].map((b) => S.enumeratePaths(scene, b).valid.length);
  assert.deepEqual(counts, [3, 5, 7]); // 2 new paths per extra bounce
  const { result } = run(SC.parallelMirrors);
  for (const path of result.valid) {
    assert.ok(path.maxAngleError < LAW_BUDGET, "reflection law within budget");
    // every leg length is positive and finite
    for (let i = 1; i < path.points.length; i++) {
      assert.ok(G.dist(path.points[i - 1], path.points[i]) > 1e-9);
    }
  }
  // multi-bounce paths are strictly longer than the direct path
  const direct = result.valid.find((p) => p.bounces === 0);
  for (const path of result.valid) {
    if (path.bounces > 0) assert.ok(path.length > direct.length);
  }
});

test("parallel mirrors: finite boundary rejects over-long sequences", () => {
  const scene = SC.parallelMirrors();
  const result = S.enumeratePaths(scene, 4);
  assert.ok(result.counts.outside_segment >= 1);
  const rejected = result.rejected.find((r) => r.reason === "outside_segment");
  assert.ok(rejected.rejectedPoint);
});

test("right-angle corner: one bounce per mirror plus two-bounce corner path", () => {
  const { result } = run(SC.rightAngle);
  const byBounce = { 0: 0, 1: 0, 2: 0 };
  for (const path of result.valid) byBounce[path.bounces]++;
  assert.deepEqual(byBounce, { 0: 1, 1: 2, 2: 1 });
  for (const path of result.valid) {
    assert.ok(path.maxAngleError < LAW_BUDGET);
  }
  // the physically impossible reversed ordering is rejected
  assert.ok(result.rejected.some((r) => r.reason === "unfold_order"));
});

test("occluder: direct path rejected, reflected path still reachable", () => {
  const { result } = run(SC.occludedDirect);
  assert.equal(result.valid.length, 1);
  assert.equal(result.valid[0].bounces, 1);
  assert.equal(result.counts.occluded, 1);
  const rejection = result.rejected.find((r) => r.reason === "occluded");
  assert.ok(G.dist(rejection.rejectedPoint, { x: 3, y: 2 }) < 1e-9);
});

test("finite boundary: reflection point beyond segment end is rejected", () => {
  const { result } = run(SC.finiteBoundary);
  assert.equal(result.valid.length, 1); // direct only
  assert.equal(result.counts.outside_segment, 1);
  const rejection = result.rejected[0];
  assert.ok(Math.abs(rejection.rejectedPoint.x - 4) < 1e-9);
  assert.ok(rejection.rejectedPoint.x > 1); // beyond short mirror's end at x=1
});

test("collinear mirror pair produces no duplicate geometric path", () => {
  const { result } = run(SC.collinearPair);
  const keys = new Set(result.valid.map((p) =>
    p.points.map((q) => `${q.x},${q.y}`).join("|")));
  assert.equal(keys.size, result.valid.length);
  assert.equal(result.valid.length, 2); // direct + single reflected path
  assert.equal(result.duplicates, 1); // two mirror sequences, one geometry
  assert.equal(result.rejected.length, 0);
});

test("non-intended mirror blocking a leg is reported", () => {
  const { result } = run(SC.mirrorBlocker);
  assert.equal(result.valid.length, 0);
  assert.ok(result.counts.blocked_by_mirror >= 1);
});

test("all reflection points stay on their intended finite segments", () => {
  for (const factory of Object.values(SC)) {
    const scene = factory();
    const { result } = run(factory);
    for (const path of result.valid) {
      path.sequence.forEach((mirrorIndex, k) => {
        const point = path.points[k + 1];
        assert.ok(S.onSegment(point, scene.mirrors[mirrorIndex]),
          `${scene.name}: hit on mirror ${mirrorIndex}`);
      });
    }
  }
});

test("enumeration is deterministic across repeated runs", () => {
  const scene = SC.parallelMirrors();
  const a = S.enumeratePaths(scene, 3);
  const b = S.enumeratePaths(scene, 3);
  assert.deepEqual(
    a.valid.map((p) => p.points),
    b.valid.map((p) => p.points)
  );
});
