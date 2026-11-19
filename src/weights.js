export const MAX_INFLUENCES = 4;

function finiteNonNegative(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Sanitizes four-influence vertex weights.
 *
 * Policy:
 * - NaN, Infinity and negative weights are treated as zero.
 * - Invalid joint indices are treated as zero.
 * - Remaining weights are normalized to sum to 1.
 * - A zero-sum vertex is bound rigidly to fallbackJoint (default 0).
 * The original typed arrays are never mutated.
 */
export function normalizeSkinWeights(
  joints,
  weights,
  boneCount,
  {
    influences = MAX_INFLUENCES,
    fallbackJoint = 0,
    zeroWeightPolicy = "fallback",
  } = {},
) {
  if (!Number.isInteger(boneCount) || boneCount < 1) {
    throw new Error("boneCount must be a positive integer");
  }
  if (fallbackJoint < 0 || fallbackJoint >= boneCount) {
    throw new Error("fallbackJoint is outside the skeleton");
  }
  const vertexCount = Math.floor(joints.length / influences);
  if (weights.length !== vertexCount * influences) {
    throw new Error("joint and weight arrays must have the same length");
  }
  if (zeroWeightPolicy !== "fallback" && zeroWeightPolicy !== "drop") {
    throw new Error("zeroWeightPolicy must be 'fallback' or 'drop'");
  }

  const normalizedJoints = new Uint16Array(joints.length);
  const normalizedWeights = new Float32Array(weights.length);
  const report = {
    vertexCount,
    zeroWeightVertexCount: 0,
    normalizedVertexCount: 0,
    invalidWeightCount: 0,
    invalidJointCount: 0,
    fallbackVertexCount: 0,
    droppedVertexCount: 0,
    warnings: [],
  };

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * influences;
    let sum = 0;
    for (let slot = 0; slot < influences; slot += 1) {
      const rawWeight = weights[offset + slot];
      const rawJoint = Number(joints[offset + slot]);
      let weight = finiteNonNegative(rawWeight);
      if (weight !== rawWeight) {
        report.invalidWeightCount += 1;
      }
      if (!Number.isInteger(rawJoint) || rawJoint < 0 || rawJoint >= boneCount) {
        if (weight > 0) {
          report.invalidJointCount += 1;
        }
        weight = 0;
      }
      normalizedJoints[offset + slot] = weight > 0 ? rawJoint : 0;
      normalizedWeights[offset + slot] = weight;
      sum += weight;
    }

    if (sum <= 1e-8) {
      report.zeroWeightVertexCount += 1;
      if (zeroWeightPolicy === "fallback") {
        normalizedJoints[offset] = fallbackJoint;
        normalizedWeights[offset] = 1;
        report.fallbackVertexCount += 1;
      } else {
        report.droppedVertexCount += 1;
      }
      continue;
    }

    const inverseSum = 1 / sum;
    if (Math.abs(sum - 1) > 1e-6) {
      report.normalizedVertexCount += 1;
    }
    for (let slot = 0; slot < influences; slot += 1) {
      normalizedWeights[offset + slot] *= inverseSum;
    }
  }

  if (report.zeroWeightVertexCount > 0) {
    report.warnings.push(
      `${report.zeroWeightVertexCount} zero-weight vertices were handled with policy '${zeroWeightPolicy}'`,
    );
  }
  if (report.normalizedVertexCount > 0) {
    report.warnings.push(
      `${report.normalizedVertexCount} vertices had non-normalized weights`,
    );
  }
  return { joints: normalizedJoints, weights: normalizedWeights, report };
}
