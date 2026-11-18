import {
  SUBPIXEL_SCALE,
  fromFixed,
  rasterizeScene,
  snapToSubpixel,
  toFixed,
} from "./rasterizer.js";

const ORDER_CACHE = new Map();

export function permutations(numbers) {
  const key = numbers.join(",");
  if (ORDER_CACHE.has(key)) return ORDER_CACHE.get(key);

  if (numbers.length <= 1) return [numbers];
  const result = [];
  numbers.forEach((value, index) => {
    const rest = numbers.filter((_, restIndex) => restIndex !== index);
    permutations(rest).forEach((tail) => result.push([value, ...tail]));
  });
  ORDER_CACHE.set(key, result);
  return result;
}

export function translatePoint(point, deltaX, deltaY) {
  return {
    x: snapToSubpixel(point.x + deltaX / SUBPIXEL_SCALE),
    y: snapToSubpixel(point.y + deltaY / SUBPIXEL_SCALE),
  };
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

export function collinearPoint(start, end, amount) {
  const ax = toFixed(start.x);
  const ay = toFixed(start.y);
  const bx = toFixed(end.x);
  const by = toFixed(end.y);
  const dx = bx - ax;
  const dy = by - ay;
  const divisor = greatestCommonDivisor(dx, dy);

  if (divisor <= 1) return { ...start };

  const stepX = dx / divisor;
  const stepY = dy / divisor;
  const stepped = Math.max(
    1,
    Math.min(divisor - 1, Math.round(amount * divisor)),
  );

  return {
    x: fromFixed(ax + stepX * stepped),
    y: fromFixed(ay + stepY * stepped),
  };
}

function translatedGeometry(base, deltaX, deltaY) {
  return Object.fromEntries(
    Object.entries(base).map(([key, point]) => [
      key,
      translatePoint(point, deltaX, deltaY),
    ]),
  );
}

function triangle(geometry, names) {
  return names.map((name) => geometry[name]);
}

function unionMask(scene) {
  const mask = new Uint8Array(scene.width * scene.height);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = scene.resultA.coverage[index] | scene.resultB.coverage[index];
  }
  return mask;
}

function sameMask(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  if (abx * apy - aby * apx !== 0) return false;
  const dot = apx * abx + apy * aby;
  const lengthSquared = abx * abx + aby * aby;
  return dot >= 0 && dot <= lengthSquared;
}

export function sharedEdgePixels(geometry, width, height) {
  const a = geometry.a;
  const b = geometry.b;
  const samples = [];
  const half = SUBPIXEL_SCALE / 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = x * SUBPIXEL_SCALE + half;
      const py = y * SUBPIXEL_SCALE + half;
      if (
        isOnSegment(
          px,
          py,
          toFixed(a.x),
          toFixed(a.y),
          toFixed(b.x),
          toFixed(b.y),
        )
      ) {
        samples.push({ x, y, px, py });
      }
    }
  }

  return samples;
}

function inspectSharedEdge(scene, geometry) {
  const samples = sharedEdgePixels(geometry, scene.width, scene.height);
  let coveredOnce = 0;
  let gaps = 0;
  let duplicates = 0;

  samples.forEach(({ x, y }) => {
    const count = scene.coverageCount[y * scene.width + x];
    if (count === 0) gaps += 1;
    else if (count > 1) duplicates += 1;
    else coveredOnce += 1;
  });

  return { samples, coveredOnce, gaps, duplicates };
}

function verifyOrders(base, width, height) {
  const orders = permutations([0, 1, 2]);
  const baselineGeometry = translatedGeometry(base, 0, 0);
  const baseline = rasterizeScene(
    triangle(baselineGeometry, ["a", "c", "b"]),
    triangle(baselineGeometry, ["b", "d", "a"]),
    width,
    height,
  );
  const baselineMask = unionMask(baseline);

  let combinations = 0;
  let sharedSamples = 0;
  let gaps = 0;
  let duplicates = 0;
  let maskMismatches = 0;
  let overdraw = 0;

  orders.forEach((orderA) => {
    orders.forEach((orderB) => {
      const namesA = orderA.map((index) => ["a", "c", "b"][index]);
      const namesB = orderB.map((index) => ["b", "d", "a"][index]);
      const scene = rasterizeScene(
        triangle(baselineGeometry, namesA),
        triangle(baselineGeometry, namesB),
        width,
        height,
      );
      const edge = inspectSharedEdge(scene, baselineGeometry);

      combinations += 1;
      sharedSamples += edge.samples.length;
      gaps += edge.gaps;
      duplicates += edge.duplicates;
      overdraw += scene.overdrawPixels;
      if (!sameMask(unionMask(scene), baselineMask)) maskMismatches += 1;
    });
  });

  return {
    id: "winding",
    label: "顶点顺序",
    status:
      gaps === 0 &&
      duplicates === 0 &&
      maskMismatches === 0 &&
      overdraw === 0
        ? "pass"
        : "fail",
    detail: `${combinations}/${combinations} 排列 · ${sharedSamples} 共享边采样`,
    metrics: {
      combinations,
      sharedSamples,
      gaps,
      duplicates,
      maskMismatches,
      overdraw,
    },
  };
}

function verifySubpixels(base, width, height) {
  let cases = 0;
  let sharedSamples = 0;
  let gaps = 0;
  let duplicates = 0;
  let overdraw = 0;

  for (let axis = 0; axis < 2; axis += 1) {
    for (let step = 0; step < SUBPIXEL_SCALE; step += 1) {
      const deltaX = axis === 0 ? step : 0;
      const deltaY = axis === 1 ? step : 0;
      const geometry = translatedGeometry(base, deltaX, deltaY);
      const order = step % 2 === 0;
      const scene = rasterizeScene(
        triangle(geometry, order ? ["a", "c", "b"] : ["c", "a", "b"]),
        triangle(geometry, order ? ["b", "d", "a"] : ["a", "b", "d"]),
        width,
        height,
      );
      const edge = inspectSharedEdge(scene, geometry);

      cases += 1;
      sharedSamples += edge.samples.length;
      gaps += edge.gaps;
      duplicates += edge.duplicates;
      overdraw += scene.overdrawPixels;
    }
  }

  return {
    id: "subpixel",
    label: "亚像素平移",
    status: gaps === 0 && duplicates === 0 && overdraw === 0 ? "pass" : "fail",
    detail: `${cases} 个 1/16 px 采样位 · ${sharedSamples} 共享边采样`,
    metrics: { cases, sharedSamples, gaps, duplicates, overdraw },
  };
}

function verifyDegenerate(base, width, height) {
  const geometry = translatedGeometry(base, 0, 0);
  geometry.g = collinearPoint(base.a, base.b, 0.625);
  const scene = rasterizeScene(
    triangle(geometry, ["a", "g", "b"]),
    triangle(geometry, ["b", "d", "a"]),
    width,
    height,
  );
  const zeroArea = scene.resultA.prepared.area === 0;
  const zeroPixels = scene.resultA.pixelCount === 0;

  return {
    id: "degenerate",
    label: "退化三角形",
    status: zeroArea && zeroPixels ? "pass" : "fail",
    detail: zeroArea && zeroPixels ? "面积 = 0 · 覆盖 = 0" : "退化处理异常",
    metrics: {
      area: scene.resultA.prepared.area,
      pixelCount: scene.resultA.pixelCount,
    },
  };
}

export function runVerification(base, width, height) {
  const groups = [
    verifyOrders(base, width, height),
    verifySubpixels(base, width, height),
    verifyDegenerate(base, width, height),
  ];

  return {
    ok: groups.every((group) => group.status === "pass"),
    groups,
    generatedAt: Date.now(),
  };
}
