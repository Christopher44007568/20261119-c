import test from "node:test";
import assert from "node:assert/strict";

import {
  SUBPIXEL_SCALE,
  edgeFunction,
  evaluatePixel,
  isTopLeft,
  prepareTriangle,
  rasterizeScene,
  snapToSubpixel,
  toFixed,
} from "../js/rasterizer.js";
import {
  collinearPoint,
  permutations,
  runVerification,
  sharedEdgePixels,
} from "../js/verification.js";

const WIDTH = 64;
const HEIGHT = 46;
const BASE = {
  a: { x: 15, y: 17 },
  b: { x: 49, y: 31 },
  c: { x: 22, y: 38 },
  d: { x: 45, y: 12 },
};

function scene(orderA = ["a", "c", "b"], orderB = ["b", "d", "a"]) {
  return rasterizeScene(
    orderA.map((key) => BASE[key]),
    orderB.map((key) => BASE[key]),
    WIDTH,
    HEIGHT,
  );
}

test("coordinates are quantized to a 1/16 pixel fixed-point grid", () => {
  assert.equal(SUBPIXEL_SCALE, 16);
  assert.equal(toFixed(12.03125), 193);
  assert.equal(snapToSubpixel(3.04), 3.0625);
  assert.equal(snapToSubpixel(3.06), 3.0625);
});

test("top-left rule is complementary on opposite directed edges", () => {
  const edges = [
    [0, 0, 10, 0],
    [0, 0, 10, 10],
    [0, 0, -10, 10],
    [10, 10, 3, 2],
  ];

  edges.forEach(([ax, ay, bx, by]) => {
    assert.notEqual(isTopLeft(ax, ay, bx, by), isTopLeft(bx, by, ax, ay));
  });
});

test("a pixel center exactly on the shared edge is covered exactly once", () => {
  const result = scene();
  const samples = sharedEdgePixels(BASE, WIDTH, HEIGHT);

  assert.ok(samples.length > 0);
  samples.forEach(({ x, y }) => {
    assert.equal(result.coverageCount[y * WIDTH + x], 1);
  });
  assert.equal(result.overdrawPixels, 0);
});

test("all 36 triangle winding pairs produce the same union mask", () => {
  const baseline = scene();
  const baselineUnion = new Uint8Array(WIDTH * HEIGHT);
  for (let index = 0; index < baselineUnion.length; index += 1) {
    baselineUnion[index] =
      baseline.resultA.coverage[index] | baseline.resultB.coverage[index];
  }

  const orders = permutations([0, 1, 2]);
  orders.forEach((orderA) => {
    orders.forEach((orderB) => {
      const namesA = orderA.map((index) => ["a", "c", "b"][index]);
      const namesB = orderB.map((index) => ["b", "d", "a"][index]);
      const result = scene(namesA, namesB);

      assert.equal(result.overdrawPixels, 0);
      for (let index = 0; index < baselineUnion.length; index += 1) {
        const union =
          result.resultA.coverage[index] | result.resultB.coverage[index];
        assert.equal(union, baselineUnion[index]);
      }
    });
  });
});

test("edge function values expose zero ties with top-left metadata", () => {
  const prepared = prepareTriangle([BASE.a, BASE.c, BASE.b], ["AC", "CB", "BA"]);
  const sample = evaluatePixel(prepared, 23, 20);
  const onEdge = sample.edges.filter((edge) => edge.onEdge);
  const sharedEdge = sample.edges.find(
    (edge) => edge.label === "AC" || edge.label === "BA",
  );

  assert.ok(sharedEdge);
  assert.ok(onEdge.every((edge) => typeof edge.topLeft === "boolean"));
  assert.ok(sample.edges.every((edge) => Number.isInteger(edge.value)));
});

test("degenerate collinear points have zero area and no fragments", () => {
  const point = collinearPoint(BASE.a, BASE.b, 0.625);
  const area = edgeFunction(
    toFixed(BASE.a.x),
    toFixed(BASE.a.y),
    toFixed(BASE.b.x),
    toFixed(BASE.b.y),
    toFixed(point.x),
    toFixed(point.y),
  );
  const result = rasterizeScene(
    [BASE.a, point, BASE.b],
    [BASE.b, BASE.d, BASE.a],
    WIDTH,
    HEIGHT,
  );

  assert.equal(area, 0);
  assert.equal(result.resultA.prepared.area, 0);
  assert.equal(result.resultA.pixelCount, 0);
});

test("the full verification suite passes for the demo geometry", () => {
  const report = runVerification(BASE, WIDTH, HEIGHT);
  assert.equal(report.ok, true);
  report.groups.forEach((group) => {
    assert.equal(group.status, "pass", `${group.label}: ${group.detail}`);
  });
});
