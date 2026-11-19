export class DtwInputError extends Error {
  constructor(message, code = "INVALID_INPUT", details = null) {
    super(message);
    this.name = "DtwInputError";
    this.code = code;
    this.details = details;
  }
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new DtwInputError(`${label} 必须是有限数字`, "INVALID_NUMBER");
  }
  return number;
}

function vectorFrom(value, jointName) {
  if (Array.isArray(value)) {
    if (value.length === 0 || !value.every((item) => Number.isFinite(Number(item)))) {
      throw new DtwInputError(`关节 ${jointName} 的坐标无效`, "INVALID_JOINT");
    }
    return value.map(Number);
  }
  if (value && typeof value === "object") {
    const vector = [value.x, value.y, value.z].filter((item) => item !== undefined);
    if (vector.length > 0 && vector.every((item) => Number.isFinite(Number(item)))) {
      return vector.map(Number);
    }
  }
  throw new DtwInputError(`关节 ${jointName} 必须是坐标数组或 {x,y,z}`, "INVALID_JOINT");
}

function frameJoints(frame) {
  return frame?.joints ?? frame?.positions ?? frame?.pose ?? frame;
}

function jointEntries(joints, fallbackNames) {
  if (Array.isArray(joints)) {
    const names = fallbackNames ?? joints.map((_, index) => `joint_${index}`);
    if (joints.length !== names.length) {
      throw new DtwInputError("每帧的关节数量必须一致", "JOINT_COUNT_MISMATCH");
    }
    return names.map((name, index) => [name, joints[index]]);
  }
  if (!joints || typeof joints !== "object") {
    throw new DtwInputError("帧中缺少 joints / positions 数据", "MISSING_JOINTS");
  }
  return Object.entries(joints);
}

export function normalizeClip(input, fallbackName = "clip") {
  if (!input) {
    throw new DtwInputError("片段数据为空", "EMPTY_CLIP");
  }
  const rawFrames = Array.isArray(input) ? input : input.frames ?? input.samples;
  if (!Array.isArray(rawFrames) || rawFrames.length === 0) {
    throw new DtwInputError("片段必须包含至少一帧", "EMPTY_CLIP");
  }

  const explicitFps = Number(input.fps);
  const fps = Number.isFinite(explicitFps) && explicitFps > 0 ? explicitFps : 30;
  const firstEntries = jointEntries(frameJoints(rawFrames[0]));
  const jointNames = firstEntries.map(([name]) => name);
  const frames = rawFrames.map((frame, index) => {
    const time = finiteNumber(
      frame?.time ?? frame?.timestamp ?? (index === 0 ? 0 : index / fps),
      `第 ${index} 帧时间`,
    );
    const entries = jointEntries(frameJoints(frame), Array.isArray(frameJoints(frame)) ? jointNames : undefined);
    const byName = new Map(entries);
    if (byName.size !== jointNames.length || jointNames.some((name) => !byName.has(name))) {
      throw new DtwInputError(
        `第 ${index} 帧的关节名称与首帧不一致`,
        "JOINT_NAMES_MISMATCH",
      );
    }
    const positions = jointNames.map((name) => vectorFrom(byName.get(name), name));
    return { time, positions };
  });

  const dimensions = frames[0].positions[0].length;
  if (dimensions !== 2 && dimensions !== 3) {
    throw new DtwInputError("关节坐标必须为 2D 或 3D", "INVALID_DIMENSION");
  }
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    if (frameIndex > 0 && frame.time <= frames[frameIndex - 1].time) {
      throw new DtwInputError("帧时间戳必须严格递增", "NON_MONOTONIC_TIME");
    }
    for (const position of frame.positions) {
      if (position.length !== dimensions) {
        throw new DtwInputError("所有关节必须使用相同的坐标维度", "DIMENSION_MISMATCH");
      }
    }
  }

  return {
    name: String(input.name ?? fallbackName),
    fps,
    jointNames,
    dimensions,
    frames,
  };
}

export function parseClipJSON(text, fallbackName = "clip") {
  try {
    return normalizeClip(JSON.parse(text), fallbackName);
  } catch (error) {
    if (error instanceof DtwInputError) throw error;
    throw new DtwInputError("JSON 解析失败：" + error.message, "PARSE_ERROR");
  }
}

export function clipDuration(clip) {
  return Math.max(0, clip.frames.at(-1).time - clip.frames[0].time);
}

export function normalizeWeights(weights, jointNames) {
  if (!weights) return new Map(jointNames.map((name) => [name, 1]));
  const entries = weights instanceof Map ? [...weights] : Object.entries(weights);
  const map = new Map(jointNames.map((name) => [name, 1]));
  for (const [name, raw] of entries) {
    if (!map.has(name)) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new DtwInputError(`关节 ${name} 的权重必须是非负数字`, "INVALID_WEIGHT");
    }
    map.set(name, value);
  }
  const total = [...map.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return new Map(jointNames.map((name) => [name, 1]));
  }
  return map;
}

export function computeLocalCostMatrix(reference, target, weights) {
  const n = reference.frames.length;
  const m = target.frames.length;
  const jointNames = reference.jointNames;
  if (target.jointNames.length !== jointNames.length) {
    throw new DtwInputError("两个片段必须包含相同数量的关节", "JOINT_COUNT_MISMATCH");
  }
  const normalizedWeights = normalizeWeights(weights, jointNames);
  const matrix = new Float64Array(n * m);
  const targetIndexByName = new Map(target.jointNames.map((name, index) => [name, index]));
  const alignedTarget = new Map(
    jointNames.map((name) => {
      const index = targetIndexByName.get(name);
      if (index === undefined) {
        throw new DtwInputError(`目标片段缺少关节 ${name}`, "JOINT_NAMES_MISMATCH");
      }
      return [name, index];
    }),
  );
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      let squared = 0;
      let coordinates = 0;
      for (let jointIndex = 0; jointIndex < jointNames.length; jointIndex += 1) {
        const name = jointNames[jointIndex];
        const weight = normalizedWeights.get(name);
        if (weight === 0) continue;
        const a = reference.frames[i].positions[jointIndex];
        const b = target.frames[j].positions[alignedTarget.get(name)];
        for (let axis = 0; axis < a.length; axis += 1) {
          squared += weight * (a[axis] - b[axis]) ** 2;
          coordinates += 1;
        }
      }
      matrix[i * m + j] = coordinates ? Math.sqrt(squared / coordinates) : 0;
    }
  }
  return {
    values: matrix,
    rows: n,
    cols: m,
    jointNames,
    weights: normalizedWeights,
  };
}

export function normalizeAnchor(anchor) {
  if (Array.isArray(anchor)) return { ref: Number(anchor[0]), target: Number(anchor[1]) };
  if (!anchor || typeof anchor !== "object") {
    throw new DtwInputError("锚点格式无效", "INVALID_ANCHOR");
  }
  return {
    ref: Number(anchor.ref ?? anchor.i ?? anchor.a),
    target: Number(anchor.target ?? anchor.j ?? anchor.b),
  };
}

export function validateAnchors(anchors, n, m) {
  const normalized = (anchors ?? []).map(normalizeAnchor);
  for (let index = 0; index < normalized.length; index += 1) {
    const anchor = normalized[index];
    if (!Number.isInteger(anchor.ref) || !Number.isInteger(anchor.target)) {
      throw new DtwInputError("锚点帧号必须是整数", "INVALID_ANCHOR");
    }
    if (anchor.ref < 0 || anchor.ref >= n || anchor.target < 0 || anchor.target >= m) {
      throw new DtwInputError("锚点超出片段帧范围", "ANCHOR_OUT_OF_RANGE");
    }
    if (index > 0) {
      const previous = normalized[index - 1];
      if (anchor.ref <= previous.ref || anchor.target <= previous.target) {
        throw new DtwInputError(
          `锚点顺序冲突：第 ${index + 1} 个锚点必须同时在 A/B 时间轴上向后`,
          "ANCHOR_ORDER_CONFLICT",
          { previous, current: anchor, index },
        );
      }
    }
  }
  return normalized;
}

export function resolveAnchors(anchors, n, m) {
  const custom = validateAnchors(anchors, n, m);
  const resolved = [...custom];
  if (!resolved.some((anchor) => anchor.ref === 0 && anchor.target === 0)) {
    resolved.push({ ref: 0, target: 0, boundary: true });
  }
  if (!resolved.some((anchor) => anchor.ref === n - 1 && anchor.target === m - 1)) {
    resolved.push({ ref: n - 1, target: m - 1, boundary: true });
  }
  resolved.sort((a, b) => a.ref - b.ref || a.target - b.target);
  return resolved;
}
