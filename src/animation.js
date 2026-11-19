import { localMatrixFromTransform } from "./skeleton.js";

export function createAnimationClip({ name, duration, tracks, loop = true }) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Animation duration must be positive");
  }
  for (const [boneName, keys] of Object.entries(tracks)) {
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new Error(`Track ${boneName} needs at least one key`);
    }
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index].time <= keys[index - 1].time) {
        throw new Error(`Track ${boneName} key times must be ascending`);
      }
    }
  }
  return { name, duration, tracks, loop };
}

export function sampleClip(clip, time, bindPose) {
  const duration = clip.duration;
  let sampleTime = clip.loop && duration > 0 ? ((time % duration) + duration) % duration : time;
  sampleTime = Math.min(Math.max(sampleTime, 0), duration);
  return bindPose.map((bindTransform) => {
    const boneName = bindTransform.name;
    const keys = clip.tracks[boneName];
    if (!keys) {
      return copyTransform(bindTransform);
    }
    return sampleTrack(keys, sampleTime, bindTransform);
  });
}

function sampleTrack(keys, time, bindTransform) {
  let right = keys.findIndex((key) => key.time >= time);
  if (right === -1) {
    right = keys.length - 1;
  }
  const left = Math.max(0, right - 1);
  const keyA = keys[left];
  const keyB = keys[right];
  const span = keyB.time - keyA.time;
  const alpha = span > 1e-8 ? clamp01((time - keyA.time) / span) : 0;

  const positionA = keyA.position ?? bindTransform.position;
  const positionB = keyB.position ?? positionA;
  const scaleA = keyA.scale ?? bindTransform.scale;
  const scaleB = keyB.scale ?? scaleA;
  const rotationA = keyA.rotation ?? bindTransform.rotation;
  const rotationB = keyB.rotation ?? rotationA;

  return {
    name: bindTransform.name,
    position: lerpVector(positionA, positionB, alpha),
    rotation: slerp(rotationA, rotationB, alpha),
    scale: lerpVector(scaleA, scaleB, alpha),
  };
}

export function crossfadePoses(poseA, poseB, blend) {
  if (poseA.length !== poseB.length) {
    throw new Error("Crossfaded poses must contain the same number of bones");
  }
  const weight = clamp01(blend);
  return poseA.map((transformA, index) => {
    const transformB = poseB[index];
    return {
      name: transformA.name,
      position: lerpVector(transformA.position, transformB.position, weight),
      rotation: slerp(transformA.rotation, transformB.rotation, weight),
      scale: lerpVector(transformA.scale, transformB.scale, weight),
    };
  });
}

export function sampleCrossfade(
  clipA,
  clipB,
  timeA,
  timeB,
  blend,
  bindPose,
) {
  const poseA = sampleClip(clipA, timeA, bindPose);
  const poseB = sampleClip(clipB, timeB, bindPose);
  return crossfadePoses(poseA, poseB, blend);
}

export function poseToLocalMatrices(pose) {
  return pose.map((transform) => {
    const matrix = localMatrixFromTransform(transform);
    transform.matrix = matrix;
    return matrix;
  });
}

export function slerp(a, b, t) {
  let [ax, ay, az, aw] = normalizeQuaternion(a);
  let [bx, by, bz, bw] = normalizeQuaternion(b);
  let cosine = ax * bx + ay * by + az * bz + aw * bw;
  if (cosine < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosine = -cosine;
  }
  if (cosine > 0.9995) {
    return normalizeQuaternion([
      lerp(ax, bx, t),
      lerp(ay, by, t),
      lerp(az, bz, t),
      lerp(aw, bw, t),
    ]);
  }
  const angle = Math.acos(Math.min(cosine, 1));
  const sine = Math.sin(angle);
  const weightA = Math.sin((1 - t) * angle) / sine;
  const weightB = Math.sin(t * angle) / sine;
  return [
    ax * weightA + bx * weightB,
    ay * weightA + by * weightB,
    az * weightA + bz * weightB,
    aw * weightA + bw * weightB,
  ];
}

export function normalizeQuaternion(quaternion) {
  const length = Math.hypot(...quaternion);
  if (length < 1e-8) {
    return [0, 0, 0, 1];
  }
  return quaternion.map((value) => value / length);
}

export function quaternionFromEulerDegrees(x, y, z) {
  return quaternionFromEuler(x * Math.PI / 180, y * Math.PI / 180, z * Math.PI / 180);
}

export function quaternionFromEuler(x, y, z) {
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return normalizeQuaternion([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ]);
}

function copyTransform(transform) {
  return {
    name: transform.name,
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

function lerpVector(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
