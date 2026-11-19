const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../src/geometry.js");

test("point reflection across a line is its own inverse", () => {
  const p = { x: 3, y: 2 };
  const lineP = { x: 0, y: 0 };
  const lineD = { x: 1, y: 1 };
  const r = G.reflectPointLine(p, lineP, lineD);
  const back = G.reflectPointLine(r, lineP, lineD);
  assert.ok(Math.abs(back.x - p.x) < 1e-12);
  assert.ok(Math.abs(back.y - p.y) < 1e-12);
});

test("reflecting (0,1) across horizontal line gives (0,-1)", () => {
  const r = G.reflectPointLine({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 });
  assert.deepEqual(r, { x: 0, y: -1 });
});

test("ray/segment intersection and parallel miss", () => {
  const hit = G.raySegment({ x: 0, y: 1 }, { x: 1, y: -1 },
    { x: 2, y: -1 }, { x: 2, y: 1 });
  assert.ok(hit);
  assert.ok(Math.abs(hit.point.x - 2) < 1e-12);
  assert.ok(Math.abs(hit.point.y + 1) < 1e-12);
  const miss = G.raySegment({ x: 0, y: 0 }, { x: 1, y: 0 },
    { x: 2, y: 1 }, { x: 4, y: 1 });
  assert.equal(miss, null);
});

test("segments intersect only when overlapping", () => {
  assert.equal(G.segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 0 },
    { x: 2, y: -2 }, { x: 2, y: 2 }), true);
  assert.equal(G.segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 },
    { x: 2, y: -2 }, { x: 2, y: 2 }), false);
  // shared endpoint counts as touching
  assert.equal(G.segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 0 },
    { x: 2, y: 0 }, { x: 3, y: 1 }), true);
});

test("reflection law on a tilted mirror (angle error zero)", () => {
  const u = G.normalize({ x: 1, y: 1 });
  const incoming = G.normalize({ x: 1, y: -2 });
  const reflected = G.reflectDirection(incoming, u);
  const normal = G.normalize({ x: -u.y, y: u.x });
  const cosIn = Math.abs(G.dot(incoming, normal));
  const cosOut = Math.abs(G.dot(reflected, normal));
  assert.ok(Math.abs(cosIn - cosOut) < 1e-12);
});
