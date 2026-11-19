import { DtwInputError } from "./dtw.js";

function interpolateMapping(mapping, referenceFloat) {
  const lower = Math.floor(referenceFloat);
  const upper = Math.min(mapping.length - 1, Math.ceil(referenceFloat));
  const fraction = referenceFloat - lower;
  return mapping[lower] + (mapping[upper] - mapping[lower]) * fraction;
}

function interpolatePose(target, targetFloat) {
  const lowerIndex = Math.floor(targetFloat);
  const upperIndex = Math.min(target.frames.length - 1, Math.ceil(targetFloat));
  const fraction = targetFloat - lowerIndex;
  const lower = target.frames[lowerIndex];
  const upper = target.frames[upperIndex];
  return lower.positions.map((position, jointIndex) =>
    position.map(
      (coordinate, axis) =>
        coordinate + (upper.positions[jointIndex][axis] - coordinate) * fraction,
    ),
  );
}

function interpolateTime(reference, referenceFloat) {
  const lowerIndex = Math.floor(referenceFloat);
  const upperIndex = Math.min(reference.frames.length - 1, Math.ceil(referenceFloat));
  const fraction = referenceFloat - lowerIndex;
  const from = reference.frames[lowerIndex].time;
  const to = reference.frames[upperIndex].time;
  return from + (to - from) * fraction;
}

function buildSegmentMapping(alignment, start, end) {
  const sums = new Float64Array(end.ref - start.ref + 1);
  const counts = new Uint32Array(sums.length);
  for (const pair of alignment.path) {
    if (pair.ref < start.ref || pair.ref > end.ref) continue;
    sums[pair.ref - start.ref] += pair.target;
    counts[pair.ref - start.ref] += 1;
  }
  const mapping = new Float64Array(sums.length);
  for (let index = 0; index < mapping.length; index += 1) {
    mapping[index] = counts[index] ? sums[index] / counts[index] : start.target;
  }
  mapping[0] = start.target;
  if (mapping.length > 1) mapping[mapping.length - 1] = end.target;
  for (let index = 1; index < mapping.length; index += 1) {
    mapping[index] = Math.max(mapping[index - 1], mapping[index]);
  }
  return mapping;
}

export function resampleSegment(alignment, segmentIndex, options = {}) {
  const numericIndex = Number(segmentIndex);
  if (!Number.isInteger(numericIndex) || numericIndex < 0 || numericIndex >= alignment.segments.length) {
    throw new DtwInputError("重采样片段编号无效", "INVALID_SEGMENT");
  }
  const { start, end } = alignment.segments[numericIndex];
  const referenceSpan = end.ref - start.ref;
  const requestedFrames = Number(options.frameCount);
  const defaultFrames = Math.max(1, referenceSpan + 1);
  const frameCount =
    Number.isFinite(requestedFrames) && requestedFrames >= 1
      ? Math.min(2000, Math.round(requestedFrames))
      : defaultFrames;
  const localMapping = buildSegmentMapping(alignment, start, end);
  const frames = [];
  const correspondence = [];

  for (let index = 0; index < frameCount; index += 1) {
    const fraction = frameCount === 1 ? 0 : index / (frameCount - 1);
    const referenceFloat = start.ref + referenceSpan * fraction;
    const localReference = referenceFloat - start.ref;
    const targetFloat = Math.max(
      start.target,
      Math.min(end.target, interpolateMapping(localMapping, localReference)),
    );
    const positions = interpolatePose(alignment.target, targetFloat);
    const joints = Object.fromEntries(
      alignment.target.jointNames.map((name, jointIndex) => [name, positions[jointIndex]]),
    );
    frames.push({
      time: interpolateTime(alignment.reference, referenceFloat),
      joints,
    });
    correspondence.push({
      referenceIndex: referenceFloat,
      targetIndex: targetFloat,
    });
  }

  return {
    name: `${alignment.target.name} · 片段 ${numericIndex + 1} 重采样`,
    segmentIndex: numericIndex,
    anchors: { start, end },
    referenceRange: { from: start.ref, to: end.ref },
    targetRange: { from: start.target, to: end.target },
    frameCount,
    frames,
    correspondence,
  };
}

export function resampledClipToJSON(result) {
  return {
    name: result.name,
    fps: result.frameCount > 1 ? (result.frameCount - 1) / Math.max(
      result.frames.at(-1).time - result.frames[0].time,
      1e-9,
    ) : 30,
    anchors: result.anchors,
    frames: result.frames,
  };
}
