import { createSkeleton } from "./skeleton.js";
import { normalize3 } from "./math.js";
import {
  createAnimationClip,
  quaternionFromEulerDegrees,
} from "./animation.js";

const BONE_DEFINITIONS = [
  { name: "Root", parent: -1 },
  { name: "Hips", parent: 0, position: [0, 1.05, 0] },
  { name: "Spine", parent: 1, position: [0, 0.55, 0] },
  { name: "Chest", parent: 2, position: [0, 0.5, 0] },
  { name: "Neck", parent: 3, position: [0, 0.35, 0] },
  { name: "Head", parent: 4, position: [0, 0.25, 0] },
  { name: "LeftUpperArm", parent: 3, position: [-0.38, 0.15, 0] },
  { name: "LeftLowerArm", parent: 6, position: [-0.52, 0, 0] },
  { name: "LeftHand", parent: 7, position: [-0.45, 0, 0] },
  { name: "RightUpperArm", parent: 3, position: [0.38, 0.15, 0] },
  { name: "RightLowerArm", parent: 9, position: [0.52, 0, 0] },
  { name: "RightHand", parent: 10, position: [0.45, 0, 0] },
  { name: "LeftUpperLeg", parent: 1, position: [-0.21, -0.05, 0] },
  { name: "LeftLowerLeg", parent: 12, position: [0, -0.55, 0] },
  { name: "LeftFoot", parent: 13, position: [0, -0.55, 0] },
  { name: "RightUpperLeg", parent: 1, position: [0.21, -0.05, 0] },
  { name: "RightLowerLeg", parent: 15, position: [0, -0.55, 0] },
  { name: "RightFoot", parent: 16, position: [0, -0.55, 0] },
];

export function createDemoScene() {
  const skeleton = createSkeleton(BONE_DEFINITIONS);
  const joint = (name) => {
    const matrix = skeleton.byName.get(name).bindWorld;
    return [matrix[12], matrix[13], matrix[14]];
  };
  const mesh = createCharacterMesh(skeleton);
  return {
    skeleton,
    mesh,
    joint,
    animations: createDemoAnimations(),
  };
}

function createCharacterMesh(skeleton) {
  const builder = {
    positions: [],
    normals: [],
    joints: [],
    weights: [],
    indices: [],
  };
  const boneIndex = (name) => skeleton.byName.get(name).index;
  const joint = (name) => {
    const matrix = skeleton.byName.get(name).bindWorld;
    return [matrix[12], matrix[13], matrix[14]];
  };
  const rigid = (name) => () => [[boneIndex(name), 1]];
  const blend = (a, b, start = 0.65, end = 0.95) =>
    (t) => {
      const amount = smoothstep(start, end, t);
      return [[boneIndex(a), 1 - amount], [boneIndex(b), amount]];
    };

  addEllipsoid(builder, {
    center: [0, 1.02, 0],
    radii: [0.36, 0.26, 0.25],
    weightAt: rigid("Hips"),
  });
  addEllipsoid(builder, {
    center: [0, 1.62, 0],
    radii: [0.41, 0.56, 0.26],
    weightAt: (t) => {
      const chest = smoothstep(0.42, 0.82, t);
      return [[boneIndex("Spine"), 1 - chest], [boneIndex("Chest"), chest]];
    },
  });
  addEllipsoid(builder, {
    center: [0, 2.27, 0],
    radii: [0.14, 0.24, 0.14],
    weightAt: rigid("Neck"),
  });
  addEllipsoid(builder, {
    center: [0, 2.81, 0],
    radii: [0.29, 0.32, 0.29],
    weightAt: rigid("Head"),
  });

  addLimb(builder, joint("LeftUpperArm"), joint("LeftLowerArm"), 0.14, blend("LeftUpperArm", "LeftLowerArm"));
  addLimb(builder, joint("LeftLowerArm"), joint("LeftHand"), 0.115, blend("LeftLowerArm", "LeftHand"));
  addEllipsoid(builder, {
    center: joint("LeftHand"),
    radii: [0.15, 0.12, 0.11],
    weightAt: rigid("LeftHand"),
  });
  addLimb(builder, joint("RightUpperArm"), joint("RightLowerArm"), 0.14, blend("RightUpperArm", "RightLowerArm"));
  addLimb(builder, joint("RightLowerArm"), joint("RightHand"), 0.115, blend("RightLowerArm", "RightHand"));
  addEllipsoid(builder, {
    center: joint("RightHand"),
    radii: [0.15, 0.12, 0.11],
    weightAt: rigid("RightHand"),
  });

  addLimb(builder, joint("LeftUpperLeg"), joint("LeftLowerLeg"), 0.16, blend("LeftUpperLeg", "LeftLowerLeg"));
  addLimb(builder, joint("LeftLowerLeg"), joint("LeftFoot"), 0.13, blend("LeftLowerLeg", "LeftFoot"));
  addLimb(builder, joint("RightUpperLeg"), joint("RightLowerLeg"), 0.16, blend("RightUpperLeg", "RightLowerLeg"));
  addLimb(builder, joint("RightLowerLeg"), joint("RightFoot"), 0.13, blend("RightLowerLeg", "RightFoot"));
  addFoot(builder, joint("LeftFoot"), rigid("LeftFoot"));
  addFoot(builder, joint("RightFoot"), rigid("RightFoot"));

  return {
    positions: new Float32Array(builder.positions),
    normals: new Float32Array(builder.normals),
    joints: new Uint16Array(builder.joints),
    weights: new Float32Array(builder.weights),
    indices: new Uint16Array(builder.indices),
  };
}

function addLimb(builder, start, end, radius, weightAt) {
  const axis = normalize3([end[0] - start[0], end[1] - start[1], end[2] - start[2]]);
  const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  addEllipsoid(builder, {
    center: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2],
    radii: [radius, radius, length / 2],
    axis,
    weightAt,
  });
}

function addFoot(builder, ankle, weightAt) {
  addEllipsoid(builder, {
    center: [ankle[0], ankle[1] - 0.03, ankle[2] + 0.12],
    radii: [0.15, 0.10, 0.25],
    weightAt,
    slices: 12,
    stacks: 7,
  });
}

function addEllipsoid(
  builder,
  {
    center,
    radii,
    axis = [0, 1, 0],
    weightAt,
    slices = 14,
    stacks = 9,
  },
) {
  const base = builder.positions.length / 3;
  const forward = normalize3(axis);
  const helper = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const side = normalize3(cross(helper, forward));
  const up = normalize3(cross(forward, side));

  for (let stack = 0; stack <= stacks; stack += 1) {
    const phi = Math.PI * stack / stacks;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let slice = 0; slice <= slices; slice += 1) {
      const theta = Math.PI * 2 * slice / slices;
      const local = [sinPhi * Math.cos(theta), sinPhi * Math.sin(theta), cosPhi];
      const point = [0, 1, 2].map((axisIndex) =>
        center[axisIndex] +
        side[axisIndex] * local[0] * radii[0] +
        up[axisIndex] * local[1] * radii[1] +
        forward[axisIndex] * local[2] * radii[2],
      );
      const localNormal = normalize3([
        local[0] / radii[0],
        local[1] / radii[1],
        local[2] / radii[2],
      ]);
      const normal = normalize3([0, 1, 2].map((axisIndex) =>
        side[axisIndex] * localNormal[0] +
        up[axisIndex] * localNormal[1] +
        forward[axisIndex] * localNormal[2],
      ));
      addVertex(builder, point, normal, weightAt((local[2] + 1) / 2));
    }
  }

  const row = slices + 1;
  for (let stack = 0; stack < stacks; stack += 1) {
    for (let slice = 0; slice < slices; slice += 1) {
      const a = base + stack * row + slice;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      builder.indices.push(a, b, c, b, d, c);
    }
  }
}

function addVertex(builder, position, normal, influences) {
  builder.positions.push(...position);
  builder.normals.push(...normal);
  const slots = [[0, 0], [0, 0], [0, 0], [0, 0]];
  influences.slice(0, 4).forEach(([joint, weight], index) => {
    slots[index] = [joint, weight];
  });
  for (const [joint, weight] of slots) {
    builder.joints.push(joint);
    builder.weights.push(weight);
  }
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function smoothstep(start, end, value) {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function createDemoAnimations() {
  const euler = quaternionFromEulerDegrees;
  const sway = createAnimationClip({
    name: "Sway",
    duration: 3,
    tracks: {
      Hips: [
        { time: 0, position: [0, 1.05, 0], rotation: euler(0, 0, 2) },
        { time: 0.75, position: [-0.05, 1.07, 0], rotation: euler(0, -5, 3) },
        { time: 1.5, position: [0, 1.05, 0], rotation: euler(0, 0, 2) },
        { time: 2.25, position: [0.05, 1.07, 0], rotation: euler(0, 5, 1) },
        { time: 3, position: [0, 1.05, 0], rotation: euler(0, 0, 2) },
      ],
      Spine: [
        { time: 0, rotation: euler(0, 0, -2) },
        { time: 0.75, rotation: euler(3, 5, 4) },
        { time: 1.5, rotation: euler(0, 0, -2) },
        { time: 2.25, rotation: euler(-3, -5, -4) },
        { time: 3, rotation: euler(0, 0, -2) },
      ],
      Chest: [
        { time: 0, rotation: euler(0, 0, 0) },
        { time: 0.75, rotation: euler(0, 8, -3) },
        { time: 1.5, rotation: euler(0, 0, 0) },
        { time: 2.25, rotation: euler(0, -8, 3) },
        { time: 3, rotation: euler(0, 0, 0) },
      ],
      Head: [
        { time: 0, rotation: euler(0, 0, 0) },
        { time: 0.75, rotation: euler(0, -10, 2) },
        { time: 1.5, rotation: euler(0, 0, 0) },
        { time: 2.25, rotation: euler(0, 10, -2) },
        { time: 3, rotation: euler(0, 0, 0) },
      ],
      LeftUpperArm: [
        { time: 0, rotation: euler(0, 0, 8) },
        { time: 0.75, rotation: euler(8, 10, 16) },
        { time: 1.5, rotation: euler(0, 0, 8) },
        { time: 2.25, rotation: euler(-8, -10, 16) },
        { time: 3, rotation: euler(0, 0, 8) },
      ],
      RightUpperArm: [
        { time: 0, rotation: euler(0, 0, -8) },
        { time: 0.75, rotation: euler(-8, -10, -16) },
        { time: 1.5, rotation: euler(0, 0, -8) },
        { time: 2.25, rotation: euler(8, 10, -16) },
        { time: 3, rotation: euler(0, 0, -8) },
      ],
      LeftLowerArm: [
        { time: 0, rotation: euler(0, 0, 12) },
        { time: 0.75, rotation: euler(0, 12, 22) },
        { time: 1.5, rotation: euler(0, 0, 12) },
        { time: 2.25, rotation: euler(0, -12, 22) },
        { time: 3, rotation: euler(0, 0, 12) },
      ],
      RightLowerArm: [
        { time: 0, rotation: euler(0, 0, -12) },
        { time: 0.75, rotation: euler(0, -12, -22) },
        { time: 1.5, rotation: euler(0, 0, -12) },
        { time: 2.25, rotation: euler(0, 12, -22) },
        { time: 3, rotation: euler(0, 0, -12) },
      ],
      LeftUpperLeg: [
        { time: 0, rotation: euler(0, 0, 0) },
        { time: 0.75, rotation: euler(-5, 0, 0) },
        { time: 1.5, rotation: euler(0, 0, 0) },
        { time: 2.25, rotation: euler(5, 0, 0) },
        { time: 3, rotation: euler(0, 0, 0) },
      ],
      RightUpperLeg: [
        { time: 0, rotation: euler(0, 0, 0) },
        { time: 0.75, rotation: euler(5, 0, 0) },
        { time: 1.5, rotation: euler(0, 0, 0) },
        { time: 2.25, rotation: euler(-5, 0, 0) },
        { time: 3, rotation: euler(0, 0, 0) },
      ],
    },
  });

  const waveScale = [1.12, 0.72, 0.86];
  const wave = createAnimationClip({
    name: "Wave",
    duration: 2,
    tracks: {
      Hips: [
        { time: 0, position: [0, 1.05, 0], rotation: euler(0, 0, 0) },
        { time: 1, position: [0.03, 1.06, 0], rotation: euler(0, -5, 1) },
        { time: 2, position: [0, 1.05, 0], rotation: euler(0, 0, 0) },
      ],
      Spine: [
        { time: 0, rotation: euler(0, 0, 0) },
        { time: 1, rotation: euler(0, 7, -2) },
        { time: 2, rotation: euler(0, 0, 0) },
      ],
      Chest: [
        { time: 0, rotation: euler(0, 0, 0) },
        { time: 1, rotation: euler(2, 8, 2) },
        { time: 2, rotation: euler(0, 0, 0) },
      ],
      Head: [
        { time: 0, rotation: euler(0, 0, 0) },
        { time: 1, rotation: euler(0, -8, 4) },
        { time: 2, rotation: euler(0, 0, 0) },
      ],
      RightUpperArm: [
        { time: 0, rotation: euler(0, 0, -5) },
        { time: 0.4, rotation: euler(0, -5, 76), scale: waveScale },
        { time: 0.75, rotation: euler(0, -10, 60), scale: waveScale },
        { time: 1.1, rotation: euler(0, 5, 82), scale: waveScale },
        { time: 1.45, rotation: euler(0, -5, 58), scale: waveScale },
        { time: 1.8, rotation: euler(0, 0, 76), scale: waveScale },
        { time: 2, rotation: euler(0, 0, -5) },
      ],
      RightLowerArm: [
        { time: 0, rotation: euler(0, 0, 0) },
        { time: 0.4, rotation: euler(0, 20, 18) },
        { time: 0.75, rotation: euler(0, -18, 24) },
        { time: 1.1, rotation: euler(0, 20, 18) },
        { time: 1.45, rotation: euler(0, -18, 24) },
        { time: 1.8, rotation: euler(0, 20, 18) },
        { time: 2, rotation: euler(0, 0, 0) },
      ],
      RightHand: [
        { time: 0, rotation: euler(0, 0, 0) },
        { time: 0.4, rotation: euler(20, 0, 20) },
        { time: 0.75, rotation: euler(-20, 0, -15) },
        { time: 1.1, rotation: euler(20, 0, 20) },
        { time: 1.45, rotation: euler(-20, 0, -15) },
        { time: 1.8, rotation: euler(20, 0, 20) },
        { time: 2, rotation: euler(0, 0, 0) },
      ],
      LeftUpperArm: [
        { time: 0, rotation: euler(0, 0, 0) },
        { time: 1, rotation: euler(0, 4, 10) },
        { time: 2, rotation: euler(0, 0, 0) },
      ],
      LeftLowerArm: [
        { time: 0, rotation: euler(0, 0, 0) },
        { time: 1, rotation: euler(0, 0, 18) },
        { time: 2, rotation: euler(0, 0, 0) },
      ],
    },
  });

  return { sway, wave };
}
