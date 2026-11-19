import {
  DtwInputError,
  clipDuration,
  computeLocalCostMatrix,
  normalizeClip,
  resolveAnchors,
} from "./dtw.js";

function asClip(value, fallbackName) {
  return value?.frames && value?.jointNames ? value : normalizeClip(value, fallbackName);
}

function alignSegment(costMatrix, start, end) {
  const rows = end.ref - start.ref + 1;
  const cols = end.target - start.target + 1;
  const total = rows * cols;
  const cumulative = new Float64Array(total);
  cumulative.fill(Infinity);
  cumulative[0] = costMatrix.values[start.ref * costMatrix.cols + start.target];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (row === 0 && col === 0) continue;
      const localIndex = row * cols + col;
      const localCost = costMatrix.values[(start.ref + row) * costMatrix.cols + start.target + col];
      const candidates = [];
      if (row > 0 && col > 0) candidates.push(cumulative[(row - 1) * cols + col - 1]);
      if (row > 0) candidates.push(cumulative[(row - 1) * cols + col]);
      if (col > 0) candidates.push(cumulative[row * cols + col - 1]);
      const best = Math.min(...candidates);
      cumulative[localIndex] = Number.isFinite(best) ? localCost + best : Infinity;
    }
  }

  if (!Number.isFinite(cumulative[total - 1])) {
    throw new DtwInputError(
      `锚点 (${start.ref},${start.target}) 到 (${end.ref},${end.target}) 之间不存在单调路径`,
      "NO_VALID_PATH",
    );
  }

  const segmentPath = [];
  let row = rows - 1;
  let col = cols - 1;
  while (row > 0 || col > 0) {
    segmentPath.push({ ref: start.ref + row, target: start.target + col });
    const options = [];
    if (row > 0 && col > 0) {
      options.push({ row: row - 1, col: col - 1, priority: 0 });
    }
    if (row > 0) {
      options.push({ row: row - 1, col, priority: 1 });
    }
    if (col > 0) {
      options.push({ row, col: col - 1, priority: 2 });
    }
    let chosen = null;
    for (const option of options) {
      if (!Number.isFinite(cumulative[option.row * cols + option.col])) continue;
      if (
        !chosen ||
        cumulative[option.row * cols + option.col] <
          cumulative[chosen.row * cols + chosen.col] ||
        (cumulative[option.row * cols + option.col] ===
          cumulative[chosen.row * cols + chosen.col] &&
          option.priority < chosen.priority)
      ) {
        chosen = option;
      }
    }
    if (!chosen) break;
    row = chosen.row;
    col = chosen.col;
  }
  segmentPath.push({ ref: start.ref, target: start.target });
  segmentPath.reverse();
  return segmentPath;
}

function quantile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function mappingForReference(path, referenceCount) {
  const sums = new Float64Array(referenceCount);
  const counts = new Uint32Array(referenceCount);
  for (const pair of path) {
    sums[pair.ref] += pair.target;
    counts[pair.ref] += 1;
  }
  const mapping = new Float64Array(referenceCount);
  for (let index = 0; index < referenceCount; index += 1) {
    mapping[index] = counts[index] ? sums[index] / counts[index] : 0;
  }
  return mapping;
}

function regressionSlope(xs, ys) {
  if (xs.length < 3) return null;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < xs.length; index += 1) {
    covariance += (xs[index] - meanX) * (ys[index] - meanY);
    variance += (xs[index] - meanX) ** 2;
  }
  return variance > 0 ? covariance / variance : null;
}

function computeStretch(referenceCount, targetCount, mapping) {
  if (referenceCount < 3 || targetCount < 2) {
    return { profile: [], values: [], stats: null, histogram: null };
  }
  const radius = Math.max(2, Math.min(8, Math.round(referenceCount * 0.04)));
  const profile = [];
  for (let index = 0; index < referenceCount; index += 1) {
    const from = Math.max(0, index - radius);
    const to = Math.min(referenceCount - 1, index + radius);
    const xs = [];
    const ys = [];
    for (let cursor = from; cursor <= to; cursor += 1) {
      xs.push(cursor / (referenceCount - 1));
      ys.push(mapping[cursor] / (targetCount - 1));
    }
    const slope = regressionSlope(xs, ys);
    if (slope !== null) {
      profile.push({ referenceFrame: index, factor: Math.max(0, slope) });
    }
  }

  const values = profile.map((point) => point.factor).sort((a, b) => a - b);
  const maxValue = values.at(-1) ?? 1;
  const domainMax = Math.max(1.5, Math.ceil(maxValue * 10) / 10);
  const binCount = 12;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    from: (domainMax / binCount) * index,
    to: (domainMax / binCount) * (index + 1),
    count: 0,
  }));
  for (const value of values) {
    const binIndex = Math.min(binCount - 1, Math.floor((value / domainMax) * binCount));
    bins[binIndex].count += 1;
  }

  return {
    profile,
    values,
    stats: {
      min: values[0],
      p10: quantile(values, 0.1),
      median: quantile(values, 0.5),
      p90: quantile(values, 0.9),
      max: values.at(-1),
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    },
    histogram: { bins, domainMin: 0, domainMax },
  };
}

function countPathSteps(path) {
  const counts = { diagonal: 0, targetHold: 0, referenceHold: 0 };
  for (let index = 1; index < path.length; index += 1) {
    const deltaRef = path[index].ref - path[index - 1].ref;
    const deltaTarget = path[index].target - path[index - 1].target;
    if (deltaRef === 1 && deltaTarget === 1) counts.diagonal += 1;
    else if (deltaRef === 1) counts.targetHold += 1;
    else if (deltaTarget === 1) counts.referenceHold += 1;
  }
  return counts;
}

export function analyzeAlignment(reference, target, options = {}) {
  const n = reference.frames.length;
  const m = target.frames.length;
  if (n === 0 || m === 0) throw new DtwInputError("两个片段都不能为空", "EMPTY_CLIP");
  const anchors = (options.anchors ?? []).map((anchor) => ({
    ref: Number(anchor.ref ?? anchor.i ?? anchor[0]),
    target: Number(anchor.target ?? anchor.j ?? anchor[1]),
  }));
  const resolvedAnchors = resolveAnchors(anchors, n, m);
  const costMatrix = computeLocalCostMatrix(reference, target, options.weights);
  const path = [];
  for (let index = 1; index < resolvedAnchors.length; index += 1) {
    const segmentPath = alignSegment(
      costMatrix,
      resolvedAnchors[index - 1],
      resolvedAnchors[index],
    );
    path.push(...(index === 1 ? segmentPath : segmentPath.slice(1)));
  }

  let pathCost = 0;
  for (const pair of path) {
    pathCost += costMatrix.values[pair.ref * costMatrix.cols + pair.target];
  }
  const mapping = mappingForReference(path, n);
  const stretch = computeStretch(n, m, mapping);
  const startError = costMatrix.values[0];
  const endError = costMatrix.values[(n - 1) * costMatrix.cols + m - 1];
  const anchorErrors = anchors.map((anchor) => ({
    ...anchor,
    error: costMatrix.values[anchor.ref * costMatrix.cols + anchor.target],
  }));

  return {
    reference,
    target,
    costMatrix,
    anchors,
    resolvedAnchors,
    segments: resolvedAnchors.slice(1).map((end, index) => ({
      index,
      start: resolvedAnchors[index],
      end,
    })),
    path,
    mapping,
    stretch,
    metrics: {
      pathLength: path.length,
      pathCost,
      meanCost: pathCost / path.length,
      endpointError: {
        start: startError,
        end: endError,
        max: Math.max(startError, endError),
      },
      anchorErrors,
      steps: countPathSteps(path),
      referenceFrames: n,
      targetFrames: m,
      referenceDuration: clipDuration(reference),
      targetDuration: clipDuration(target),
    },
  };
}

export function alignClips(referenceInput, targetInput, options = {}) {
  const reference = asClip(referenceInput, "reference");
  const target = asClip(targetInput, "target");
  return {
    ...analyzeAlignment(reference, target, options),
    reference,
    target,
  };
}
