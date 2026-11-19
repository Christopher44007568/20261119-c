import test from "node:test";
import assert from "node:assert/strict";

import {
  createAnimationClip,
  poseToLocalMatrices,
  quaternionFromEulerDegrees,
  sampleCrossfade,
  slerp,
} from "../src/animation.js";
import { createDemoScene } from "../src/demo-data.js";
import { composeTRS, normalize3 } from "../src/math.js";
import {
  checkInverseBindMatrices,
  computeSkinningMatrices,
  createBindPose,
  createSkeleton,
} from "../src/skeleton.js";
import {
  buildNormalMatrices,
  checkSkinningData,
  highlightVerticesForBone,
  skinMeshCPU,
  skinVertexCPU,
} from "../src/skinning.js";
import { normalizeSkinWeights } from "../src/weights.js";

function singleBoneSkeleton(scale) {
  return createSkeleton([
    { name: "Root", parent: -1, scale },
  ]);
}

function oneVertexMesh(joints, weights, normal = [Math.SQRT1_2, Math.SQRT1_2, 0]) {
  return {
    positions: new Float32Array([1, 1, 0]),
    normals: new Float32Array(normal),
    joints: new Uint16Array([...joints, 0, 0, 0, 0].slice(0, 4)),
    weights: new Float32Array([...weights, 0, 0, 0, 0].slice(0, 4)),
    indices: new Uint16Array([0]),
  };
}

test("crossfade reaches both clips and slerps between them", () => {
  const skeleton = singleBoneSkeleton([1, 1, 1]);
  const bind = createBindPose(skeleton);
  const clipA = createAnimationClip({
    name: "A",
    duration: 1,
    tracks: {
      Root: [{ time: 0, rotation: quaternionFromEulerDegrees(0, 0, 0) }],
    },
  });
  const clipB = createAnimationClip({
    name: "B",
    duration: 1,
    tracks: {
      Root: [{ time: 0, rotation: quaternionFromEulerDegrees(0, 0, 90) }],
    },
  });

  const poseA = sampleCrossfade(clipA, clipB, 0.2, 0.8, 0, bind);
  const poseB = sampleCrossfade(clipA, clipB, 0.2, 0.8, 1, bind);
  const poseMid = sampleCrossfade(clipA, clipB, 0.2, 0.8, 0.5, bind);
  assert.ok(Math.abs(poseA[0].rotation[3] - 1) < 1e-7);
  assert.ok(Math.abs(2 * Math.atan2(poseB[0].rotation[2], poseB[0].rotation[3]) - Math.PI / 2) < 1e-6);
  const midAngle = 2 * Math.atan2(poseMid[0].rotation[2], poseMid[0].rotation[3]);
  assert.ok(Math.abs(midAngle - Math.PI / 4) < 1e-6);
});

test("slerp handles opposite quaternion signs and normalized input", () => {
  const midpoint = slerp([0, 0, 0, 1], [0, 0, -2, -2], 0.5);
  assert.ok(midpoint.every(Number.isFinite));
  assert.ok(Math.abs(2 * Math.atan2(midpoint[2], midpoint[3]) - Math.PI / 4) < 1e-6);
});

test("CPU normals use inverse-transpose under non-uniform scale", () => {
  const skeleton = singleBoneSkeleton([1, 2, 1]);
  const current = composeTRS([0, 0, 0], [0, 0, 0, 1], [2, 1, 1]);
  const skin = computeSkinningMatrices(skeleton, [current]);
  const normalMatrices = buildNormalMatrices(skin);
  const inputNormal = normalize3([1, 1, 0]);
  const result = skinVertexCPU(
    [1, 1, 0],
    inputNormal,
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    skin,
    normalMatrices,
  );
  assert.deepEqual(result.position.map((value) => Number(value.toFixed(4))), [2, 0.5, 0]);
  assert.deepEqual(
    result.normal.map((value) => Number(value.toFixed(4))),
    [0.2425, 0.9701, 0],
  );

  const naiveNormal = normalize3([inputNormal[0] * 2, inputNormal[1] * 0.5, 0]);
  assert.ok(Math.abs(naiveNormal[0] - result.normal[0]) > 0.5);
});

test("CPU bind-pose path restores positions and normals bit-exactly", () => {
  const scene = createDemoScene();
  const normalized = normalizeSkinWeights(
    scene.mesh.joints,
    scene.mesh.weights,
    scene.skeleton.bones.length,
  );
  const mesh = { ...scene.mesh, ...normalized };
  const bind = createBindPose(scene.skeleton);
  const localMatrices = poseToLocalMatrices(bind);
  const skinMatrices = computeSkinningMatrices(scene.skeleton, localMatrices);
  const result = skinMeshCPU(mesh, skinMatrices);
  assert.equal(result.bindPose, true);
  assert.deepEqual(result.positions, mesh.positions);
  assert.deepEqual(result.normals, mesh.normals);
  assert.equal(result.maxPositionDelta, 0);
  assert.equal(result.maxNormalDelta, 0);
});

test("zero-weight CPU reference mirrors the GPU unskinned fallback", () => {
  const skeleton = singleBoneSkeleton([1, 1, 1]);
  const current = composeTRS([4, 2, 0], [0, 0, 0, 1], [1, 1, 1]);
  const skin = computeSkinningMatrices(skeleton, [current]);
  const result = skinVertexCPU(
    [1, 1, 0],
    [0, 0, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    skin,
  );
  assert.deepEqual(result.position, [1, 1, 0]);
  assert.deepEqual(result.normal, [0, 0, 1]);
});

test("demo skin data is normalized and inverse bind matrices are valid", () => {
  const scene = createDemoScene();
  const normalized = normalizeSkinWeights(
    scene.mesh.joints,
    scene.mesh.weights,
    scene.skeleton.bones.length,
  );
  assert.equal(normalized.report.zeroWeightVertexCount, 0);
  assert.equal(normalized.report.normalizedVertexCount, 0);
  const mesh = { ...scene.mesh, joints: normalized.joints, weights: normalized.weights };
  const skinCheck = checkSkinningData(mesh, scene.skeleton.bones.length);
  assert.equal(skinCheck.ok, true);
  assert.ok(skinCheck.maxWeightError < 1e-6);
  assert.equal(checkInverseBindMatrices(scene.skeleton).ok, true);
});

test("debug influence query returns per-bone vertex coverage", () => {
  const scene = createDemoScene();
  const normalized = normalizeSkinWeights(
    scene.mesh.joints,
    scene.mesh.weights,
    scene.skeleton.bones.length,
  );
  const mesh = { ...scene.mesh, joints: normalized.joints, weights: normalized.weights };
  const bone = scene.skeleton.byName.get("RightUpperArm").index;
  const influence = highlightVerticesForBone(mesh, bone);
  assert.equal(influence.length, mesh.positions.length / 3);
  assert.ok(influence.filter((weight) => weight > 0.01).length > 0);
  assert.ok(influence.every((weight) => weight >= 0 && weight <= 1.0001));
});

test("animated demo matrices and CPU skinning stay finite", () => {
  const scene = createDemoScene();
  const normalized = normalizeSkinWeights(
    scene.mesh.joints,
    scene.mesh.weights,
    scene.skeleton.bones.length,
  );
  const mesh = { ...scene.mesh, joints: normalized.joints, weights: normalized.weights };
  const bind = createBindPose(scene.skeleton);
  for (const time of [0, 0.4, 1.1, 2.4]) {
    for (const blend of [0, 0.5, 1]) {
      const pose = sampleCrossfade(
        scene.animations.sway,
        scene.animations.wave,
        time,
        time * 1.07 + 0.37,
        blend,
        bind,
      );
      const skin = computeSkinningMatrices(scene.skeleton, poseToLocalMatrices(pose));
      assert.ok(skin.every((matrix) => matrix.every(Number.isFinite)));
      const result = skinMeshCPU(mesh, skin);
      assert.ok(result.positions.every(Number.isFinite));
      assert.ok(result.normals.every(Number.isFinite));
    }
  }
});
