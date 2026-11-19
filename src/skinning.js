import {
  identity,
  maxAbsDifference,
  normalMatrix,
  normalize3,
  transformNormal,
  transformPoint,
} from "./math.js";

export function buildNormalMatrices(skinMatrices) {
  return skinMatrices.map((matrix) => normalMatrix(matrix));
}

export function skinVertexCPU(
  position,
  normal,
  joints,
  weights,
  skinMatrices,
  normalMatrices = buildNormalMatrices(skinMatrices),
) {
  const skinnedPosition = [0, 0, 0];
  const skinnedNormal = [0, 0, 0];
  let weightTotal = 0;
  for (let slot = 0; slot < joints.length; slot += 1) {
    const weight = weights[slot];
    weightTotal += weight;
    const bone = joints[slot];
    if (!(weight > 0)) {
      continue;
    }
    if (bone < 0 || bone >= skinMatrices.length) {
      throw new Error(`Joint index ${bone} is outside the skin palette`);
    }
    const point = transformPoint(skinMatrices[bone], position);
    const direction = transformNormal(normalMatrices[bone], normal);
    skinnedPosition[0] += point[0] * weight;
    skinnedPosition[1] += point[1] * weight;
    skinnedPosition[2] += point[2] * weight;
    skinnedNormal[0] += direction[0] * weight;
    skinnedNormal[1] += direction[1] * weight;
    skinnedNormal[2] += direction[2] * weight;
  }
  if (weightTotal <= 1e-8) {
    return {
      position: [...position],
      normal: normalize3(normal),
    };
  }
  return {
    position: skinnedPosition,
    normal: normalize3(skinnedNormal),
  };
}

/**
 * Per-vertex CPU reference used by tests and by the debug panel.
 * Input weights must already be normalized by normalizeSkinWeights().
 */
export function skinMeshCPU(mesh, skinMatrices, options = {}) {
  const influences = options.influences ?? 4;
  const normalMatrices = options.normalMatrices ?? buildNormalMatrices(skinMatrices);
  const vertexCount = mesh.positions.length / 3;
  const bindPose = skinMatrices.every(
    (matrix) => maxAbsDifference(matrix, identity()) <= 1e-7,
  );
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);

  if (bindPose) {
    positions.set(mesh.positions);
    normals.set(mesh.normals);
    return {
      positions,
      normals,
      bindPose: true,
      maxPositionDelta: 0,
      maxNormalDelta: 0,
    };
  }

  let maxPositionDelta = 0;
  let maxNormalDelta = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const positionIndex = vertex * 3;
    const influenceIndex = vertex * influences;
    const result = skinVertexCPU(
      [
        mesh.positions[positionIndex],
        mesh.positions[positionIndex + 1],
        mesh.positions[positionIndex + 2],
      ],
      [
        mesh.normals[positionIndex],
        mesh.normals[positionIndex + 1],
        mesh.normals[positionIndex + 2],
      ],
      Array.from(mesh.joints.slice(influenceIndex, influenceIndex + influences)),
      Array.from(mesh.weights.slice(influenceIndex, influenceIndex + influences)),
      skinMatrices,
      normalMatrices,
    );
    positions.set(result.position, positionIndex);
    normals.set(result.normal, positionIndex);
    maxPositionDelta = Math.max(
      maxPositionDelta,
      Math.abs(result.position[0] - mesh.positions[positionIndex]),
      Math.abs(result.position[1] - mesh.positions[positionIndex + 1]),
      Math.abs(result.position[2] - mesh.positions[positionIndex + 2]),
    );
    maxNormalDelta = Math.max(
      maxNormalDelta,
      Math.abs(result.normal[0] - mesh.normals[positionIndex]),
      Math.abs(result.normal[1] - mesh.normals[positionIndex + 1]),
      Math.abs(result.normal[2] - mesh.normals[positionIndex + 2]),
    );
  }
  return {
    positions,
    normals,
    bindPose: false,
    maxPositionDelta,
    maxNormalDelta,
  };
}

export function checkSkinningData(mesh, boneCount, influences = 4) {
  const vertexCount = mesh.positions.length / 3;
  const failures = [];
  let zeroWeightVertices = 0;
  let unnormalizedVertices = 0;
  let invalidJoints = 0;
  let maxWeightError = 0;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * influences;
    let sum = 0;
    for (let slot = 0; slot < influences; slot += 1) {
      const weight = mesh.weights[offset + slot];
      const joint = mesh.joints[offset + slot];
      if (!Number.isFinite(weight) || weight < 0) {
        failures.push({ vertex, reason: "invalid weight" });
      }
      if (joint < 0 || joint >= boneCount) {
        invalidJoints += 1;
        failures.push({ vertex, reason: `invalid joint ${joint}` });
      }
      sum += Number.isFinite(weight) ? weight : 0;
    }
    if (sum <= 1e-8) {
      zeroWeightVertices += 1;
    }
    const error = Math.abs(sum - 1);
    maxWeightError = Math.max(maxWeightError, error);
    if (error > 1e-5) {
      unnormalizedVertices += 1;
    }
  }
  return {
    ok: failures.length === 0 && zeroWeightVertices === 0 && unnormalizedVertices === 0,
    vertexCount,
    zeroWeightVertices,
    unnormalizedVertices,
    invalidJoints,
    maxWeightError,
    failures: failures.slice(0, 20),
  };
}

export function highlightVerticesForBone(mesh, bone, influences = 4) {
  const vertexCount = mesh.positions.length / 3;
  const influence = new Float32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * influences;
    let weight = 0;
    for (let slot = 0; slot < influences; slot += 1) {
      if (mesh.joints[offset + slot] === bone) {
        weight += mesh.weights[offset + slot];
      }
    }
    influence[vertex] = weight;
  }
  return influence;
}
