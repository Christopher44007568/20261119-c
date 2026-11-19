export const MAX_BINS = 128;
export const QUANTILE_PROBABILITIES = Object.freeze([
  0, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 1,
]);

export const QUANTILE_LABELS = Object.freeze([
  "P0",
  "P1",
  "P5",
  "P25",
  "P50",
  "P75",
  "P95",
  "P99",
  "P100",
]);

export const DEFAULT_CONFIG = Object.freeze({
  bins: 18,
  min: -0.15,
  max: 1.15,
  workgroupSize: 256,
});

export const SPECIAL_INDEX = Object.freeze({
  nan: "nan",
  outOfRange: "outOfRange",
});

export function validateConfig(config) {
  const bins = Number(config.bins);
  const min = Number(config.min);
  const max = Number(config.max);
  const workgroupSize = Number(config.workgroupSize);
  const errors = [];

  if (!Number.isInteger(bins) || bins < 2 || bins > MAX_BINS) {
    errors.push(`桶数必须是 2–${MAX_BINS} 的整数`);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    errors.push("范围端点必须是有限数值");
  } else if (!(min < max)) {
    errors.push("最小值必须小于最大值");
  }
  if (
    !Number.isInteger(workgroupSize) ||
    workgroupSize < 32 ||
    workgroupSize > 256 ||
    workgroupSize % 32 !== 0
  ) {
    errors.push("工作组大小必须是 32–256 的 32 倍数");
  }

  return { ok: errors.length === 0, errors };
}

export function normalizeConfig(config) {
  const normalized = {
    bins: Math.trunc(Number(config.bins)),
    min: Math.fround(Number(config.min)),
    max: Math.fround(Number(config.max)),
    workgroupSize: Math.trunc(Number(config.workgroupSize)),
  };
  const validation = validateConfig(normalized);
  if (!validation.ok) {
    throw new RangeError(validation.errors.join("；"));
  }
  return normalized;
}

export function classifyValue(value, config) {
  const bins = config.bins;
  if (Number.isNaN(value)) {
    return { kind: "nan", index: bins };
  }
  if (value < config.min || value > config.max) {
    return { kind: "outOfRange", index: bins + 1 };
  }
  if (value >= config.max) {
    return { kind: "bin", index: bins - 1 };
  }

  const span = Math.fround(config.max - config.min);
  const scaled = Math.fround(Math.fround(value - config.min) / span);
  const rawBin = Math.floor(Math.fround(scaled * bins));
  return {
    kind: "bin",
    index: Math.min(Math.max(rawBin, 0), bins - 1),
  };
}

export function toFloat32(values) {
  const result = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    result[index] = Math.fround(values[index]);
  }
  return result;
}

export function prefixSum(values) {
  const result = new Uint32Array(values.length);
  let running = 0;
  for (let index = 0; index < values.length; index += 1) {
    running += values[index] >>> 0;
    result[index] = running >>> 0;
  }
  return result;
}

export function quantileBinsFromCdf(cdf, bins) {
  if (!bins) {
    return QUANTILE_PROBABILITIES.map(() => null);
  }
  const total = cdf[bins - 1] >>> 0;
  if (total === 0) {
    return QUANTILE_PROBABILITIES.map(() => null);
  }

  return QUANTILE_PROBABILITIES.map((probability) => {
    const target = Math.min(
      total,
      Math.max(
        1,
        Math.ceil(Math.fround(Math.fround(probability) * Math.fround(total))),
      ),
    );
    let low = 0;
    let high = bins - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (cdf[middle] >= target) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return low;
  });
}

export function binInterval(index, config) {
  const span = config.max - config.min;
  const width = span / config.bins;
  return {
    low: config.min + index * width,
    high: config.min + (index + 1) * width,
  };
}

export function binMidpoint(index, config) {
  if (index === null || index === undefined || index === 0xffffffff) {
    return null;
  }
  const interval = binInterval(index, config);
  return index === config.bins - 1
    ? config.max
    : (interval.low + interval.high) / 2;
}

export function buildReference(values, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const input = toFloat32(values);
  const count = input.length;
  const width = config.bins + 2;
  const workgroups =
    count === 0 ? 0 : Math.ceil(count / config.workgroupSize);
  const histogram = new Uint32Array(width);
  const localHistogram = new Uint32Array(workgroups * width);

  for (let index = 0; index < count; index += 1) {
    const classification = classifyValue(input[index], config);
    histogram[classification.index] += 1;
    if (workgroups > 0) {
      const group = Math.floor(index / config.workgroupSize);
      localHistogram[group * width + classification.index] += 1;
    }
  }

  const cdf = prefixSum(histogram.subarray(0, config.bins));
  return {
    config,
    count,
    workgroups,
    lastGroupSize:
      count === 0 ? 0 : count - (workgroups - 1) * config.workgroupSize,
    histogram,
    localHistogram,
    cdf,
    quantileBins: quantileBinsFromCdf(cdf, config.bins),
    nanCount: histogram[config.bins],
    outOfRangeCount: histogram[config.bins + 1],
    validCount: count - histogram[config.bins] - histogram[config.bins + 1],
  };
}

export function mergeLocalHistogram(localHistogram, workgroups, bins) {
  const width = bins + 2;
  const merged = new Uint32Array(width);
  for (let group = 0; group < workgroups; group += 1) {
    for (let bin = 0; bin < width; bin += 1) {
      merged[bin] += localHistogram[group * width + bin];
    }
  }
  return merged;
}

export function isRunCurrent(
  snapshotRevision,
  runToken,
  currentRevision,
  latestRunToken,
) {
  return (
    snapshotRevision === currentRevision && runToken === latestRunToken
  );
}
