import test from "node:test";
import assert from "node:assert/strict";
import {
  computeStraightSkeleton,
  getOffsetAt,
  normalizePolygon,
  signedArea,
  validateSimplePolygon,
} from "../src/geometry.js";
import { PRESETS } from "../src/presets.js";

const preset = (id) => {
  const found = PRESETS.find((item) => item.id === id);
  assert.ok(found, `missing preset ${id}`);
  return found.points.map((point) => ({ ...point }));
};

function assertOffsetsAreSimple(result, step = 1) {
  for (let distance = 0; distance <= result.terminalTime; distance += step) {
    const offset = getOffsetAt(result, distance);
    assert.equal(
      offset.selfIntersections,
      0,
      `offset at d=${distance} self-intersects`,
    );
    for (const component of offset.components) {
      assert.ok(component.area > 0, `component at d=${distance} has no area`);
      assert.equal(
        component.selfIntersections.length,
        0,
        `component at d=${distance} self-intersects`,
      );
    }
  }
}

test("near-collinear vertices are removed with an explicit length tolerance", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 50, y: 0.000001 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const normalized = normalizePolygon(square, 1e-4);
  assert.equal(normalized.vertices.length, 4);
  assert.equal(normalized.removedCollinear, 1);
  assert.ok(Math.abs(signedArea(normalized.vertices) - 10000) < 1e-6);

  const retained = normalizePolygon(
    square.map((point, index) =>
      index === 2 ? { x: 100, y: 0.02 } : point,
    ),
    1e-4,
  );
  assert.equal(retained.vertices.length, 5);
});

test("self-intersecting input is rejected before event construction", () => {
  const bowtie = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
    { x: 100, y: 0 },
  ];
  assert.throws(
    () => validateSimplePolygon(bowtie, 1e-5),
    /不能自交/,
  );
  assert.throws(
    () => computeStraightSkeleton(bowtie, { tolerance: 1e-5 }),
    /不能自交/,
  );
});

test("convex polygon collapses monotonically without self-intersection", () => {
  const result = computeStraightSkeleton(preset("convex"), {
    tolerance: 1e-5,
  });
  assert.ok(result.events.length > 0);
  assert.equal(result.stats.splitCount, 0);
  assert.ok(result.terminalTime > 0);
  assertOffsetsAreSimple(result, 2);

  let previousArea = getOffsetAt(result, 0).totalArea;
  for (const event of result.events) {
    assert.equal(
      event.componentsAfter <= event.componentsBefore,
      true,
      "component count must not increase",
    );
    const offset = getOffsetAt(result, event.time);
    const area = offset.totalArea;
    assert.ok(area <= previousArea + 1e-6);
    previousArea = area;
  }
  assert.equal(getOffsetAt(result, result.terminalTime).componentCount, 0);
});

test("tapered narrow neck splits by reflex vertex collision then persists", () => {
  const result = computeStraightSkeleton(preset("narrow-neck"), {
    tolerance: 1e-5,
  });
  assert.ok(result.stats.splitCount >= 1);
  assert.equal(result.events[0].type, "split");
  assert.equal(result.events[0].componentsBefore, 1);
  assert.equal(result.events[0].componentsAfter, 2);

  const offset = getOffsetAt(result, 65);
  assert.equal(offset.componentCount, 2);
  assert.equal(offset.selfIntersections, 0);
  assert.ok(offset.components.every((component) => component.area > 0));
  assert.ok(offset.totalArea > 0);
  assertOffsetsAreSimple(result, 1);
  assert.equal(result.audit.passed, true);
});

test("symmetric square groups simultaneous events and vanishes at the inradius", () => {
  const result = computeStraightSkeleton(preset("symmetric"), {
    tolerance: 1e-5,
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, "simultaneous");
  assert.ok(result.stats.maxSimultaneous >= 4);
  assert.ok(Math.abs(result.events[0].time - 200) < 1e-8);

  const before = getOffsetAt(result, 199.9);
  assert.equal(before.componentCount, 1);
  assert.equal(before.selfIntersections, 0);
  assert.ok(Math.abs(before.totalArea - (400 - 399.8) ** 2) < 1e-4);

  const atEvent = getOffsetAt(result, 200);
  assert.equal(atEvent.componentCount, 0);
  assert.equal(atEvent.totalArea, 0);
  assertOffsetsAreSimple(result, 2);
});

test("offset components report independent areas that sum to the total", () => {
  const result = computeStraightSkeleton(preset("narrow-neck"), {
    tolerance: 1e-5,
  });
  for (const distance of [36, 45, 65, 90]) {
    const offset = getOffsetAt(result, distance);
    const summed = offset.components.reduce(
      (total, component) => total + component.area,
      0,
    );
    assert.ok(Math.abs(summed - offset.totalArea) < 1e-7);
  }
});
