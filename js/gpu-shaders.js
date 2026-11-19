import { QUANTILE_PROBABILITIES } from "./core.js";

const PARAMS_STRUCT = `
struct Params {
  count: u32,
  bins: u32,
  minValue: f32,
  maxValue: f32,
  workgroupSize: u32,
  workgroups: u32,
  pad0: u32,
  pad1: u32,
}
`;

const CLASSIFY_FN = `
fn classify(value: f32) -> u32 {
  let bits = bitcast<u32>(value);
  if ((bits & 0x7fffffffu) > 0x7f800000u) {
    return params.bins;
  }
  if (value < params.minValue || value > params.maxValue) {
    return params.bins + 1u;
  }
  if (value >= params.maxValue) {
    return params.bins - 1u;
  }
  let normalized = (value - params.minValue) /
    (params.maxValue - params.minValue);
  return min(
    u32(floor(normalized * f32(params.bins))),
    params.bins - 1u
  );
}
`;

export const GLOBAL_HISTOGRAM_SHADER = `
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read> samples: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> histogram: array<atomic<u32>>;
${CLASSIFY_FN}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (globalId.x >= params.count) {
    return;
  }
  let bucket = classify(samples[globalId.x]);
  atomicAdd(&histogram[bucket], 1u);
}
`;

export function localHistogramShader(workgroupSize) {
  return `
const LOCAL_CAPACITY: u32 = 130u;
const WG_SIZE: u32 = ${workgroupSize}u;

${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read> samples: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> localHistogram: array<u32>;

var<workgroup> localBins: array<atomic<u32>, 130>;
${CLASSIFY_FN}

@compute @workgroup_size(${workgroupSize})
fn main(
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) groupId: vec3<u32>,
  @builtin(global_invocation_id) globalId: vec3<u32>
) {
  for (var clearIndex = localId.x; clearIndex < LOCAL_CAPACITY;
    clearIndex = clearIndex + WG_SIZE) {
    atomicStore(&localBins[clearIndex], 0u);
  }
  workgroupBarrier();

  if (globalId.x < params.count) {
    let bucket = classify(samples[globalId.x]);
    atomicAdd(&localBins[bucket], 1u);
  }
  workgroupBarrier();

  let destination = groupId.x * (params.bins + 2u);
  for (var bucket = localId.x; bucket < params.bins + 2u;
    bucket = bucket + WG_SIZE) {
    localHistogram[destination + bucket] = atomicLoad(&localBins[bucket]);
  }
}
`;
}

export const MERGE_SHADER = `
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read> localHistogram: array<u32>;
@group(0) @binding(1) var<storage, read_write> merged: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (globalId.x >= params.bins + 2u) {
    return;
  }
  let width = params.bins + 2u;
  var sum = 0u;
  for (var group = 0u; group < params.workgroups; group = group + 1u) {
    sum = sum + localHistogram[group * width + globalId.x];
  }
  merged[globalId.x] = sum;
}
`;

export const PREFIX_SHADER = `
${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read> counts: array<u32>;
@group(0) @binding(1) var<storage, read_write> cumulative: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

var<workgroup> scan: array<u32, 128>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) localId: vec3<u32>) {
  let index = localId.x;
  if (index < params.bins) {
    scan[index] = counts[index];
  }
  workgroupBarrier();

  var offset = 1u;
  loop {
    if (offset >= params.bins) {
      break;
    }
    var contribution = 0u;
    if (index >= offset && index < params.bins) {
      contribution = scan[index - offset];
    }
    workgroupBarrier();
    if (index >= offset && index < params.bins) {
      scan[index] = scan[index] + contribution;
    }
    workgroupBarrier();
    offset = offset * 2u;
  }

  if (index < params.bins) {
    cumulative[index] = scan[index];
  }
}
`;

const PROBABILITY_LIST = QUANTILE_PROBABILITIES.map(
  (probability) => `${probability.toFixed(2)}`,
).join(", ");

export const QUANTILE_SHADER = `
const PROBABILITIES = array<f32, ${QUANTILE_PROBABILITIES.length}>(
  ${PROBABILITY_LIST}
);

${PARAMS_STRUCT}
@group(0) @binding(0) var<storage, read> cumulative: array<u32>;
@group(0) @binding(1) var<storage, read_write> quantileBins: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (globalId.x >= ${QUANTILE_PROBABILITIES.length}u) {
    return;
  }
  let total = cumulative[params.bins - 1u];
  if (total == 0u) {
    quantileBins[globalId.x] = 0xffffffffu;
    return;
  }

  let probability = PROBABILITIES[globalId.x];
  var rank = u32(ceil(probability * f32(total)));
  rank = max(rank, 1u);
  rank = min(rank, total);

  var low = 0u;
  var high = params.bins - 1u;
  loop {
    if (low >= high) {
      break;
    }
    let middle = (low + high) / 2u;
    if (cumulative[middle] >= rank) {
      high = middle;
    } else {
      low = middle + 1u;
    }
  }
  quantileBins[globalId.x] = low;
}
`;
