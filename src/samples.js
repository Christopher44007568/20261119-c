const JOINT_NAMES = [
  "pelvis",
  "spine",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftHand",
  "rightHand",
  "leftKnee",
  "rightKnee",
  "leftFoot",
  "rightFoot",
];

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function poseAt(progress) {
  const turn = progress * Math.PI * 2;
  const reach = (1 - Math.cos(turn)) / 2;
  const step = Math.sin(turn);
  const settle = Math.sin(turn * 2) * 0.035;
  return {
    pelvis: [step * 0.08, 0.92 + settle, 0],
    spine: [step * 0.1, 1.18 + settle, 0.02],
    head: [step * 0.16, 1.52 + settle, 0.05],
    leftShoulder: [-0.24, 1.35, 0],
    rightShoulder: [0.24, 1.35, 0],
    leftHand: [
      lerp(-0.43, -0.65, reach) - step * 0.06,
      lerp(1.05, 1.55, reach),
      lerp(-0.2, 0.28, reach),
    ],
    rightHand: [
      lerp(0.43, 0.65, reach) + step * 0.06,
      lerp(1.05, 1.55, reach),
      lerp(0.2, 0.28, reach),
    ],
    leftKnee: [-0.15, 0.5 + settle, step * 0.12],
    rightKnee: [0.15, 0.5 + settle, -step * 0.12],
    leftFoot: [-0.18, 0.08 + Math.max(0, step) * 0.16, 0.08],
    rightFoot: [0.18, 0.08 + Math.max(0, -step) * 0.16, -0.08],
  };
}

function makeClip(name, frameCount, duration, progressAt) {
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const fraction = frameCount === 1 ? 0 : index / (frameCount - 1);
    frames.push({
      time: Number((fraction * duration).toFixed(6)),
      joints: poseAt(progressAt(fraction)),
    });
  }
  return {
    name,
    fps: frameCount > 1 ? (frameCount - 1) / duration : 30,
    frames,
  };
}

function linear(progress) {
  return progress;
}

function speedVariant(progress) {
  return Math.min(1, Math.max(0, progress + 0.075 * Math.sin(progress * Math.PI * 2)));
}

function pauseProgress(progress) {
  if (progress < 0.38) return (progress / 0.38) * 0.42;
  if (progress < 0.62) return 0.42;
  return 0.42 + ((progress - 0.62) / 0.38) * 0.58;
}

function dropFrames(clip, indexes) {
  const drops = new Set(indexes);
  return {
    ...clip,
    name: clip.name + "（缺失帧）",
    frames: clip.frames.filter((_, index) => !drops.has(index)),
  };
}

function clone(value) {
  return structuredClone(value);
}

export function getScenario(name = "speed") {
  const reference = makeClip("A · 参考动作", 121, 4, linear);
  if (name === "pause") {
    return {
      key: "pause",
      reference: clone(reference),
      target: makeClip("B · 局部停顿", 110, 4, pauseProgress),
      anchors: [{ ref: 50, target: 55 }],
      description: "B 在中段保持同一姿态约 0.9 秒，路径应出现局部水平段。",
    };
  }
  if (name === "missing") {
    const missingBase = makeClip("B · 采样缺失", 100, 3.5, speedVariant);
    const target = dropFrames(missingBase, [18, 19, 20, 54, 76, 77]);
    return {
      key: "missing",
      reference: clone(reference),
      target,
      anchors: [{ ref: 60, target: 48 }],
      description: "B 删除 6 帧并保留时间间隔；DTW 用邻近姿态补足对应关系。",
    };
  }
  if (name === "conflict") {
    return {
      key: "conflict",
      reference: clone(reference),
      target: makeClip("B · 快慢不均", 84, 3.2, speedVariant),
      anchors: [
        { ref: 28, target: 58 },
        { ref: 82, target: 31 },
      ],
      description: "演示交叉锚点；工具会拒绝并提示顺序冲突。",
    };
  }
  return {
    key: "speed",
    reference: clone(reference),
    target: makeClip("B · 快慢不均", 84, 3.2, speedVariant),
    anchors: [{ ref: 60, target: 42 }],
    description: "同一动作，B 更短且前后速度不同；路径斜率应分段变化。",
  };
}

export const SCENARIOS = [
  { key: "speed", label: "变速片段", note: "84 帧 · 3.2s" },
  { key: "pause", label: "局部停顿", note: "中段姿态保持" },
  { key: "missing", label: "缺失帧", note: "删除 6 帧" },
  { key: "conflict", label: "冲突锚点", note: "应被拒绝" },
];

export { JOINT_NAMES, poseAt };
