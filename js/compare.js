import { QUANTILE_PROBABILITIES, mergeLocalHistogram } from "./core.js";

function countDifferences(expected, actual) {
  if (!actual || actual.length !== expected.length) {
    return Number.POSITIVE_INFINITY;
  }
  let differences = 0;
  for (let index = 0; index < expected.length; index += 1) {
    if ((expected[index] >>> 0) !== (actual[index] >>> 0)) {
      differences += 1;
    }
  }
  return differences;
}

function normalizeQuantiles(values, probabilities = QUANTILE_PROBABILITIES) {
  if (!values || values.length !== probabilities.length) {
    return null;
  }
  return Array.from(values, (value) =>
    value === 0xffffffff || value === null || value === undefined
      ? null
      : Number(value),
  );
}

function quantileDifferences(expected, actual) {
  const left = normalizeQuantiles(expected);
  const right = normalizeQuantiles(actual);
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }
  let differences = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      differences += 1;
    }
  }
  return differences;
}

export function compareResults(reference, candidate) {
  const expectedMerged = mergeLocalHistogram(
    reference.localHistogram,
    reference.workgroups,
    reference.config.bins,
  );
  const candidateMerged = candidate.mergedHistogram;
  const checks = [
    {
      id: "globalHistogram",
      label: "全局原子直方图",
      detail: "bin + NaN + 越界",
      differences: countDifferences(
        reference.histogram,
        candidate.globalHistogram,
      ),
    },
    {
      id: "localHistogram",
      label: "工作组局部桶",
      detail: `${reference.workgroups} × ${reference.config.bins + 2} 计数`,
      differences: countDifferences(
        reference.localHistogram,
        candidate.localHistogram,
      ),
    },
    {
      id: "localMerge",
      label: "局部归并结果",
      detail: "逐桶求和",
      differences: countDifferences(expectedMerged, candidateMerged),
    },
    {
      id: "globalCdf",
      label: "全局累积分布",
      detail: "GPU 前缀和",
      differences: countDifferences(reference.cdf, candidate.globalCdf),
    },
    {
      id: "localCdf",
      label: "归并累积分布",
      detail: "GPU 前缀和",
      differences: countDifferences(reference.cdf, candidate.localCdf),
    },
    {
      id: "globalQuantiles",
      label: "全局分位点",
      detail: "二分定位",
      differences: quantileDifferences(
        reference.quantileBins,
        candidate.globalQuantileBins,
      ),
    },
    {
      id: "localQuantiles",
      label: "归并分位点",
      detail: "二分定位",
      differences: quantileDifferences(
        reference.quantileBins,
        candidate.localQuantileBins,
      ),
    },
  ];

  for (const check of checks) {
    check.pass = check.differences === 0;
  }

  const specialChecks = [
    {
      id: "nanCount",
      label: "NaN 计数",
      expected: reference.nanCount,
      actual:
        candidate.globalHistogram?.[reference.config.bins] ?? null,
    },
    {
      id: "outOfRangeCount",
      label: "越界计数",
      expected: reference.outOfRangeCount,
      actual:
        candidate.globalHistogram?.[reference.config.bins + 1] ?? null,
    },
    {
      id: "sampleCount",
      label: "样本总数",
      expected: reference.count,
      actual: candidate.globalHistogram
        ? Array.from(candidate.globalHistogram).reduce(
            (sum, value) => sum + (value >>> 0),
            0,
          )
        : null,
    },
  ];

  for (const check of specialChecks) {
    check.pass = check.expected === check.actual;
  }

  const allPass =
    checks.every((check) => check.pass) &&
    specialChecks.every((check) => check.pass);
  return {
    allPass,
    checks,
    specialChecks,
    totalDifference: checks.reduce(
      (total, check) =>
        total +
        (Number.isFinite(check.differences) ? check.differences : 1_000_000),
      0,
    ),
  };
}
