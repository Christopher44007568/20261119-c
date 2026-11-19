"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../solver.js");

const result = Core.solveWeights({ cols: 52, rows: 38, iterations: 220 });

function segmentHoleSamples(a, b, count) {
  let inside = 0;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (Core.pointInPolygon(x, y, Core.HOLE)) inside++;
  }
  return inside;
}

test("void nodes are absent from the sample graph", () => {
  assert.equal(result.feasible, true);
  assert.ok(result.grid.count > 1000);
  assert.equal(result.components, 1);

  for (let ai = 0; ai < result.grid.count; ai++) {
    const gi = result.grid.activeToGrid[ai];
    assert.equal(Core.pointInDomain(result.grid.xs[gi], result.grid.ys[gi]), true);
  }
});

test("weights satisfy Dirichlet, partition and box constraints", () => {
  const metrics = result.metrics;
  assert.ok(metrics.sumError < 1e-6);
  assert.ok(metrics.dirichletError < 1e-8);
  assert.equal(metrics.boundError, 0);

  for (let ai = 0; ai < result.grid.count; ai++) {
    let sum = 0;
    for (let k = 0; k < result.fields.length; k++) {
      const value = result.fields[k][ai];
      assert.ok(value >= 0 && value <= 1);
      sum += value;
    }
    assert.ok(Math.abs(sum - 1) < 1e-6);
  }

  for (let j = 0; j < result.handleNodes.length; j++) {
    for (let k = 0; k < result.fields.length; k++) {
      const expected = j === k ? 1 : 0;
      assert.ok(Math.abs(result.fields[k][result.handleNodes[j]] - expected) < 1e-8);
    }
  }
});

test("near-void handle has support across the void without a straight path", () => {
  const handle = Core.HANDLES[3];
  const probe = { x: 0.36, y: 0.32 };
  const snap = Core.nearestActive(result.grid, probe.x, probe.y);
  const value = result.fields[3][snap.active];

  assert.ok(value > 0.03, "the far-side probe should receive near-void support");
  assert.ok(
    segmentHoleSamples(handle, probe, 200) > 0,
    "the straight chord between handle and probe must cross the void"
  );
});

test("the displayed field satisfies the discrete optimality checks", () => {
  assert.ok(result.metrics.pdeResidual < 0.01);
  assert.ok(result.metrics.kktResidual < 0.01);
  assert.ok(result.iterations >= 200);
});

test("coincident and out-of-domain Dirichlet constraints are infeasible", () => {
  const coincident = Core.HANDLES.map(function (handle, index) {
    if (index === 0) return handle;
    return Object.assign({}, handle, { x: Core.HANDLES[0].x, y: Core.HANDLES[0].y });
  });
  const duplicateResult = Core.solveWeights({ cols: 40, rows: 30, handles: coincident });
  assert.equal(duplicateResult.feasible, false);
  assert.equal(new Set(duplicateResult.handleNodes).size, 1);

  const outside = Core.HANDLES.map(function (handle, index) {
    if (index !== 1) return handle;
    return Object.assign({}, handle, { x: 0.50, y: 0.50 });
  });
  const outsideResult = Core.solveWeights({ cols: 40, rows: 30, handles: outside });
  assert.equal(outsideResult.feasible, false);
});
