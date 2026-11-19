// Small collection of stateless helpers shared by the bloom pipeline.

export const REC709 = [0.2126, 0.7152, 0.0722];

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function luminance(buffer, idx) {
  return (
    REC709[0] * buffer[idx] +
    REC709[1] * buffer[idx + 1] +
    REC709[2] * buffer[idx + 2]
  );
}

// Returns { width, height } of the next mip level (floored at 1x1).
export function nextMipSize(width, height) {
  return {
    width: Math.max(1, width >> 1),
    height: Math.max(1, height >> 1),
  };
}

// Builds the full mip size chain, starting from the full-resolution target.
export function buildMipChain(width, height) {
  const chain = [{ width, height }];
  let currentWidth = width;
  let currentHeight = height;
  while (currentWidth > 1 || currentHeight > 1) {
    const next = nextMipSize(currentWidth, currentHeight);
    chain.push(next);
    currentWidth = next.width;
    currentHeight = next.height;
  }
  return chain;
}

// Continuous number of downsample levels needed so that the coarsest footprint
// reaches the requested visual radius, expressed as a fraction of viewport
// height. The fractional part is consumed by `runBloom` as an extra blend
// weight on the coarsest level, which keeps the visual radius stable when the
// viewport resolution changes instead of jumping at integer mip boundaries.
export function levelsForRadius(radiusFraction, viewportHeight) {
  if (!(radiusFraction > 0)) return 1;
  const targetPixels = radiusFraction * viewportHeight;
  const baseFootprint = 4; // 13-tap kernel spans ~4 source texels per pass
  return Math.max(1, Math.log2(targetPixels / baseFootprint) + 1);
}

// Sum of Rec.709 luminance over every pixel of an RGB float buffer.
export function totalLuminance(buffer, width, height) {
  let sum = 0;
  for (let p = 0, i = 0; p < width * height; p++, i += 3) {
    sum += luminance(buffer, i);
  }
  return sum;
}

// Spatial statistics of a (presumably compact) emitter in one mip level.
// e90  : radius of the disc / half-width of the strip that contains 90% of
//        the level's energy, expressed in *full-resolution viewport pixels*.
// sigma: energy-weighted RMS distance from the centroid, same pixel units.
export function spatialStats(buffer, width, height, scale, lineMode = false) {
  let total = 0;
  let weightedX = 0;
  let weightedY = 0;
  const perPixel = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 3;
      const l = Math.max(0, luminance(buffer, index));
      perPixel[y * width + x] = l;
      total += l;
      weightedX += l * (x + 0.5);
      weightedY += l * (y + 0.5);
    }
  }
  if (total <= 1e-12) {
    return { totalLuminance: 0, centroid: null, e90: 0, sigma: 0 };
  }
  const centroidX = weightedX / total;
  const centroidY = weightedY / total;

  let moment = 0;
  const samples = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const l = perPixel[y * width + x];
      if (l <= 0) continue;
      const dx = x + 0.5 - centroidX;
      const dy = y + 0.5 - centroidY;
      const distanceMetric = lineMode ? Math.abs(dx) : Math.hypot(dx, dy);
      moment += l * distanceMetric * distanceMetric;
      samples.push({ d: distanceMetric, l });
    }
  }
  samples.sort((a, b) => a.d - b.d);
  const cutoff = total * 0.9;
  let accumulated = 0;
  let e90Texels = 0;
  for (const sample of samples) {
    accumulated += sample.l;
    e90Texels = sample.d;
    if (accumulated >= cutoff) break;
  }
  return {
    totalLuminance: total,
    centroid: { x: centroidX * scale, y: centroidY * scale },
    e90: e90Texels * scale,
    sigma: Math.sqrt(moment / total) * scale,
  };
}
