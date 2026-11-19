import {
  cloneMatrix,
  composeTRS,
  identity,
  invert,
  maxAbsDifference,
  multiply,
} from "./math.js";

export const DEFAULT_BIND_TRANSFORM = Object.freeze({
  position: Object.freeze([0, 0, 0]),
  rotation: Object.freeze([0, 0, 0, 1]),
  scale: Object.freeze([1, 1, 1]),
});

export function createSkeleton(boneDefinitions) {
  const bones = boneDefinitions.map((definition, index) => ({
    index,
    name: definition.name,
    parent: definition.parent ?? -1,
    bind: {
      position: [...(definition.position ?? DEFAULT_BIND_TRANSFORM.position)],
      rotation: [...(definition.rotation ?? DEFAULT_BIND_TRANSFORM.rotation)],
      scale: [...(definition.scale ?? DEFAULT_BIND_TRANSFORM.scale)],
    },
    bindWorld: identity(),
    inverseBind: identity(),
  }));

  for (const bone of bones) {
    if (bone.parent >= bone.index) {
      throw new Error(`Bone ${bone.name} must reference an earlier parent`);
    }
    if (bone.parent < -1 || bone.parent >= bones.length) {
      throw new Error(`Bone ${bone.name} has an invalid parent index`);
    }
    const localBind = localMatrixFromTransform(bone.bind);
    const parentWorld = bone.parent < 0 ? identity() : bones[bone.parent].bindWorld;
    bone.bindWorld = multiply(parentWorld, localBind);
    bone.inverseBind = invert(bone.bindWorld);
  }

  const byName = new Map(bones.map((bone) => [bone.name, bone]));
  return {
    bones,
    byName,
    bindLocalMatrices: bones.map((bone) => localMatrixFromTransform(bone.bind)),
  };
}

export function localMatrixFromTransform(transform) {
  return composeTRS(transform.position, transform.rotation, transform.scale);
}

export function createBindPose(skeleton) {
  return skeleton.bones.map((bone) => ({
    name: bone.name,
    position: [...bone.bind.position],
    rotation: [...bone.bind.rotation],
    scale: [...bone.bind.scale],
    matrix: localMatrixFromTransform(bone.bind),
  }));
}

export function computeBoneWorlds(skeleton, localMatrices) {
  if (localMatrices.length !== skeleton.bones.length) {
    throw new Error("A local matrix is required for every bone");
  }
  const worlds = skeleton.bones.map(() => identity());
  for (const bone of skeleton.bones) {
    worlds[bone.index] =
      bone.parent < 0
        ? cloneMatrix(localMatrices[bone.index])
        : multiply(worlds[bone.parent], localMatrices[bone.index]);
  }
  return worlds;
}

export function isBindPose(skeleton, localMatrices, tolerance = 1e-7) {
  return skeleton.bindLocalMatrices.every(
    (bindMatrix, index) =>
      maxAbsDifference(bindMatrix, localMatrices[index]) <= tolerance,
  );
}

/**
 * In bind pose every currentWorld * inverseBind product is exactly identity.
 * Returning identity avoids tiny floating point drift when switching back.
 */
export function computeSkinningMatrices(
  skeleton,
  localMatrices,
  { forceBindPose = false } = {},
) {
  if (forceBindPose || isBindPose(skeleton, localMatrices)) {
    return skeleton.bones.map(() => identity());
  }
  const worlds = computeBoneWorlds(skeleton, localMatrices);
  return worlds.map((world, index) => multiply(world, skeleton.bones[index].inverseBind));
}

export function checkInverseBindMatrices(skeleton, tolerance = 2e-5) {
  const failures = [];
  let worstError = 0;
  for (const bone of skeleton.bones) {
    const product = multiply(bone.bindWorld, bone.inverseBind);
    const error = maxAbsDifference(product, identity());
    worstError = Math.max(worstError, error);
    const finite = [...bone.bindWorld, ...bone.inverseBind].every(Number.isFinite);
    const determinant = determinant3(bone.bindWorld);
    if (!finite || Math.abs(determinant) < 1e-10) {
      failures.push({
        bone: bone.name,
        reason: finite ? "singular bind matrix" : "non-finite matrix",
      });
    } else if (error > tolerance) {
      failures.push({ bone: bone.name, reason: "bindWorld * inverseBind != I" });
    }
  }
  return {
    ok: failures.length === 0,
    worstError,
    tolerance,
    failures,
  };
}

export function determinant3(matrix) {
  return (
    matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9]) -
    matrix[4] * (matrix[1] * matrix[10] - matrix[2] * matrix[9]) +
    matrix[8] * (matrix[1] * matrix[6] - matrix[2] * matrix[5])
  );
}

export function flattenMatrices(matrices, target = new Float32Array(matrices.length * 16)) {
  matrices.forEach((matrix, index) => target.set(matrix, index * 16));
  return target;
}
