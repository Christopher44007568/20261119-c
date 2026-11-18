export const SUBPIXEL_BITS = 4;
export const SUBPIXEL_SCALE = 1 << SUBPIXEL_BITS;
export const FIXED_FRACTION = SUBPIXEL_SCALE;

const COLOR = {
  background: [8, 12, 18, 255],
  checker: [12, 18, 27, 255],
  triangleA: [42, 210, 235, 255],
  triangleB: [255, 164, 72, 255],
  overlap: [255, 70, 121, 255],
};

export function toFixed(value) {
  return Math.round(value * SUBPIXEL_SCALE);
}

export function fromFixed(value) {
  return value / SUBPIXEL_SCALE;
}

export function snapToSubpixel(value) {
  return Math.round(value * SUBPIXEL_SCALE) / SUBPIXEL_SCALE;
}

export function fixedToPoint(point) {
  return point.map(({ x, y }) => ({ x: toFixed(x), y: toFixed(y) }));
}

export function edgeFunction(ax, ay, bx, by, px, py) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

export function isTopLeft(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dy < 0 || (dy === 0 && dx > 0);
}

export function prepareTriangle(
  points,
  edgeLabels = ["AB", "BC", "CA"],
) {
  const fixedPoints = fixedToPoint(points);
  const [a, b, c] = fixedPoints;
  const signedArea = edgeFunction(a.x, a.y, b.x, b.y, c.x, c.y);
  const frontFacing = signedArea >= 0;

  const rawEdges = [
    { label: edgeLabels[0], ax: a.x, ay: a.y, bx: b.x, by: b.y },
    { label: edgeLabels[1], ax: b.x, ay: b.y, bx: c.x, by: c.y },
    { label: edgeLabels[2], ax: c.x, ay: c.y, bx: a.x, by: a.y },
  ];

  const edges = rawEdges.map((edge) => {
    const oriented = frontFacing
      ? edge
      : {
          label: edge.label,
          ax: edge.bx,
          ay: edge.by,
          bx: edge.ax,
          by: edge.ay,
        };

    return {
      ...oriented,
      topLeft: isTopLeft(oriented.ax, oriented.ay, oriented.bx, oriented.by),
    };
  });

  const xs = fixedPoints.map((point) => point.x);
  const ys = fixedPoints.map((point) => point.y);

  return {
    points: fixedPoints,
    signedArea,
    area: Math.abs(signedArea),
    frontFacing,
    degenerate: signedArea === 0,
    edges,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
  };
}

function sampleBounds(prepared, width, height) {
  const { minX, minY, maxX, maxY } = prepared.bounds;
  const half = SUBPIXEL_SCALE / 2;

  return {
    minX: Math.max(0, Math.floor((minX - half) / SUBPIXEL_SCALE)),
    minY: Math.max(0, Math.floor((minY - half) / SUBPIXEL_SCALE)),
    maxX: Math.min(width - 1, Math.ceil((maxX - half) / SUBPIXEL_SCALE)),
    maxY: Math.min(height - 1, Math.ceil((maxY - half) / SUBPIXEL_SCALE)),
  };
}

export function sampleFixed(x, y) {
  return {
    x: x * SUBPIXEL_SCALE + SUBPIXEL_SCALE / 2,
    y: y * SUBPIXEL_SCALE + SUBPIXEL_SCALE / 2,
  };
}

export function evaluatePixel(prepared, x, y) {
  const point = sampleFixed(x, y);
  const edges = prepared.edges.map((edge) => {
    const value = edgeFunction(
      edge.ax,
      edge.ay,
      edge.bx,
      edge.by,
      point.x,
      point.y,
    );
    const onEdge = value === 0;
    const accepted = value > 0 || (onEdge && edge.topLeft);

    return {
      ...edge,
      value,
      onEdge,
      accepted,
    };
  });

  return {
    point,
    edges,
    inside:
      !prepared.degenerate && edges.every((edge) => edge.accepted),
  };
}

export function rasterizeTriangle(points, width, height, edgeLabels) {
  const prepared = prepareTriangle(points, edgeLabels);
  const coverage = new Uint8Array(width * height);
  const edgeValues = new Int32Array(width * height * 3);
  let pixelCount = 0;

  if (prepared.degenerate) {
    return { prepared, coverage, edgeValues, pixelCount };
  }

  const bounds = sampleBounds(prepared, width, height);

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const sample = evaluatePixel(prepared, x, y);
      const index = y * width + x;
      const offset = index * 3;
      edgeValues[offset] = sample.edges[0].value;
      edgeValues[offset + 1] = sample.edges[1].value;
      edgeValues[offset + 2] = sample.edges[2].value;

      if (sample.inside) {
        coverage[index] = 1;
        pixelCount += 1;
      }
    }
  }

  return { prepared, coverage, edgeValues, pixelCount };
}

export function rasterizeScene(
  triangleA,
  triangleB,
  width,
  height,
  labelsA,
  labelsB,
) {
  const resultA = rasterizeTriangle(triangleA, width, height, labelsA);
  const resultB = rasterizeTriangle(triangleB, width, height, labelsB);
  const coverageCount = new Uint8Array(width * height);
  const coverageMask = new Uint8Array(width * height);
  const colorBuffer = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < width * height; index += 1) {
    const inA = resultA.coverage[index] === 1;
    const inB = resultB.coverage[index] === 1;
    const count = Number(inA) + Number(inB);
    coverageCount[index] = count;
    coverageMask[index] = count > 0 ? 1 : 0;

    let color = (index + Math.floor(index / width)) % 2 === 0
      ? COLOR.background
      : COLOR.checker;
    if (count === 1) {
      color = inA ? COLOR.triangleA : COLOR.triangleB;
    } else if (count > 1) {
      color = COLOR.overlap;
    }

    const offset = index * 4;
    colorBuffer[offset] = color[0];
    colorBuffer[offset + 1] = color[1];
    colorBuffer[offset + 2] = color[2];
    colorBuffer[offset + 3] = color[3];
  }

  return {
    width,
    height,
    resultA,
    resultB,
    coverageCount,
    coverageMask,
    colorBuffer,
    overdrawPixels: countOverdraw(coverageCount),
  };
}

function countOverdraw(coverageCount) {
  let count = 0;
  for (const value of coverageCount) {
    if (value > 1) count += 1;
  }
  return count;
}
