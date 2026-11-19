// Filter building blocks of the adjustable bloom pipeline.
// All buffers are linear HDR RGB Float32 arrays (no implicit clamping).

import { luminance } from './math.js';

// UE4-style quadratic soft-knee threshold.
//
//   knee    = threshold * kneeScale   (kneeScale in [0, ~1])
//   f(x)    = quadratic ramp on [threshold - knee, threshold + knee],
//             equal to 0.5 at the threshold and 1.0 at threshold + knee
//   output  = pixel * f(luminance) / luminance
//
// Below the ramp the multiplier is exactly zero, so dark regions contribute
// nothing: the bloom buffer stays black there instead of lifting the whole
// frame toward white.
export function prefilter(source, width, height, threshold, kneeScale) {
  const out = new Float32Array(source.length);
  const knee = threshold * Math.max(0, kneeScale);
  const knee2 = knee * knee;

  for (let p = 0, i = 0; p < width * height; p++, i += 3) {
    const l = luminance(source, i);
    let multiplier;
    if (l <= threshold - knee) {
      multiplier = 0;
    } else if (l < threshold + knee) {
      const x = l - threshold + knee; // 0 at ramp start, 2*knee at ramp end
      multiplier = (x * x) / (4 * knee2 + 1e-8) * 0.5 + x / (4 * knee + 1e-8);
    } else {
      multiplier = 1;
    }
    out[i] = source[i] * multiplier;
    out[i + 1] = source[i + 1] * multiplier;
    out[i + 2] = source[i + 2] * multiplier;
  }
  return out;
}

// Weighted 13-tap downsample (the classic mip filter used for bloom).
// The implementation groups 16 source taps into four buckets: the 2x2 center
// block (raw weight 4 each), four horizontal and four vertical neighbors
// (weight 2 each), and four diagonal corners (weight 1 each). Normalizing by
// the total tap weight makes the pass energy-preserving on flat fields, so
// repeated downsampling cannot progressively brighten the frame toward white.
const RAW_DOWN_WEIGHTS = [4, 2, 2, 1]; // center, horizontal, vertical, corner
const DOWN_WEIGHT_SUM =
  RAW_DOWN_WEIGHTS[0] * 4 +
  RAW_DOWN_WEIGHTS[1] * 4 +
  RAW_DOWN_WEIGHTS[2] * 4 +
  RAW_DOWN_WEIGHTS[3] * 4;

export const DOWN_WEIGHTS = RAW_DOWN_WEIGHTS.map((w) => w / DOWN_WEIGHT_SUM);

function sampleClamped(buffer, width, height, x, y, component) {
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
  return buffer[(cy * width + cx) * 3 + component];
}

export function downsample(source, srcWidth, srcHeight) {
  const dstWidth = Math.max(1, srcWidth >> 1);
  const dstHeight = Math.max(1, srcHeight >> 1);
  const out = new Float32Array(dstWidth * dstHeight * 3);
  const [wCenter, wAxis, wCross, wCorner] = DOWN_WEIGHTS;

  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      // Destination texel center maps back between two source texels.
      const sx = x * 2;
      const sy = y * 2;
      const outIndex = (y * dstWidth + x) * 3;
      for (let c = 0; c < 3; c++) {
        const center =
          sampleClamped(source, srcWidth, srcHeight, sx, sy, c) +
          sampleClamped(source, srcWidth, srcHeight, sx + 1, sy, c) +
          sampleClamped(source, srcWidth, srcHeight, sx, sy + 1, c) +
          sampleClamped(source, srcWidth, srcHeight, sx + 1, sy + 1, c);
        const horizontal =
          sampleClamped(source, srcWidth, srcHeight, sx - 1, sy, c) +
          sampleClamped(source, srcWidth, srcHeight, sx + 2, sy, c) +
          sampleClamped(source, srcWidth, srcHeight, sx - 1, sy + 1, c) +
          sampleClamped(source, srcWidth, srcHeight, sx + 2, sy + 1, c);
        const vertical =
          sampleClamped(source, srcWidth, srcHeight, sx, sy - 1, c) +
          sampleClamped(source, srcWidth, srcHeight, sx + 1, sy - 1, c) +
          sampleClamped(source, srcWidth, srcHeight, sx, sy + 2, c) +
          sampleClamped(source, srcWidth, srcHeight, sx + 1, sy + 2, c);
        const corners =
          sampleClamped(source, srcWidth, srcHeight, sx - 1, sy - 1, c) +
          sampleClamped(source, srcWidth, srcHeight, sx + 2, sy - 1, c) +
          sampleClamped(source, srcWidth, srcHeight, sx - 1, sy + 2, c) +
          sampleClamped(source, srcWidth, srcHeight, sx + 2, sy + 2, c);
        out[outIndex + c] =
          wCenter * center +
          wAxis * horizontal +
          wCross * vertical +
          wCorner * corners;
      }
    }
  }
  return { buffer: out, width: dstWidth, height: dstHeight };
}
