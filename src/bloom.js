// Full adjustable bloom pipeline:
// prefilter (threshold + soft knee) -> weighted downsample chain ->
// weighted additive upsample chain -> additive composite.

import {
  prefilter,
  downsample,
  DOWN_WEIGHTS,
} from './filters.js';
import { buildMipChain, levelsForRadius, clamp01 } from './math.js';

// Bilinearly upsample the running accumulator (coarse) to the fine level's
// resolution and add the fine mip with its per-level weight.
// The four bilinear taps sum to 1, so the upsample itself is energy-preserving;
// artistic control comes from `weight` on the fine-level contribution.
export function upsampleAndCombine(
  fineBuffer,
  fineWidth,
  fineHeight,
  coarseBuffer,
  coarseWidth,
  coarseHeight,
  weight
) {
  const out = new Float32Array(fineBuffer);
  for (let y = 0; y < fineHeight; y++) {
    for (let x = 0; x < fineWidth; x++) {
      const fx = (x + 0.5) * (coarseWidth / fineWidth) - 0.5;
      const fy = (y + 0.5) * (coarseHeight / fineHeight) - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;

      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const cx0 = x0 < 0 ? 0 : x0 >= coarseWidth ? coarseWidth - 1 : x0;
      const cy0 = y0 < 0 ? 0 : y0 >= coarseHeight ? coarseHeight - 1 : y0;
      const cx1 = x1 < 0 ? 0 : x1 >= coarseWidth ? coarseWidth - 1 : x1;
      const cy1 = y1 < 0 ? 0 : y1 >= coarseHeight ? coarseHeight - 1 : y1;

      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      const outIndex = (y * fineWidth + x) * 3;
      for (let c = 0; c < 3; c++) {
        const value =
          w00 * coarseBuffer[(cy0 * coarseWidth + cx0) * 3 + c] +
          w10 * coarseBuffer[(cy0 * coarseWidth + cx1) * 3 + c] +
          w01 * coarseBuffer[(cy1 * coarseWidth + cx0) * 3 + c] +
          w11 * coarseBuffer[(cy1 * coarseWidth + cx1) * 3 + c];
        out[outIndex + c] += weight * value;
      }
    }
  }
  return out;
}

export const DEFAULT_OPTIONS = {
  enabled: true,
  threshold: 1.0,
  kneeScale: 0.5,
  // Visual radius as a fraction of viewport height; drives how many mip
  // levels are built so the on-screen radius is independent of resolution.
  radiusFraction: 0.15,
  intensity: 1.0,
  // One artistic weight per downsample level (level 0 = prefiltered image).
  // Missing entries default to 1.
  upsampleWeights: null,
};

export function runBloom(source, width, height, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!opts.enabled) {
    return {
      enabled: false,
      composite: new Float32Array(source),
      bloom: new Float32Array(source.length),
      levels: [],
      mipSizes: [],
      downWeights: DOWN_WEIGHTS,
      upWeights: [],
    };
  }

  const fullChain = buildMipChain(width, height);
  const continuousLevels = levelsForRadius(opts.radiusFraction, height);
  // Fractional remainder blends the coarsest level so the realized radius
  // tracks the declared fraction continuously across viewport resolutions.
  const radiusLevels = Math.min(
    fullChain.length,
    Math.max(1, Math.ceil(continuousLevels))
  );
  // Exponential blend across the fractional level step: the physical radius
  // doubles per level, so a linear weight would over-soften the coarsest mip.
  const fractionalPart = clamp01(continuousLevels - (radiusLevels - 1));
  const coarsestBlend = clamp01(2 ** fractionalPart - 1);
  const mipSizes = fullChain.slice(0, radiusLevels);

  // Downsample pass: level 0 is the soft-knee prefilter result.
  const levels = [
    {
      buffer: prefilter(
        source,
        width,
        height,
        opts.threshold,
        opts.kneeScale
      ),
      width,
      height,
      scale: 1,
      level: 0,
    },
  ];
  for (let level = 1; level < mipSizes.length; level++) {
    const previous = levels[level - 1];
    const result = downsample(
      previous.buffer,
      previous.width,
      previous.height
    );
    levels.push({
      buffer: result.buffer,
      width: result.width,
      height: result.height,
      scale: 1 / 2 ** level,
      level,
    });
  }

  // Upsample pass: coarsest level seeds the accumulator, each finer level is
  // bilinearly expanded and added with its per-level weight.
  const upWeights = mipSizes.map((_, level) => {
    if (!opts.upsampleWeights) return 1;
    const w = opts.upsampleWeights[level];
    return typeof w === 'number' ? w : 1;
  });
  const coarsest = levels[levels.length - 1];
  let accumulator;
  let accWidth = coarsest.width;
  let accHeight = coarsest.height;
  if (radiusLevels === 1) {
    // No pyramid to walk: the single prefiltered level is the bloom itself,
    // still respecting its explicit upsample weight if one was supplied.
    accumulator = new Float32Array(coarsest.buffer.length);
    for (let i = 0; i < accumulator.length; i++) {
      accumulator[i] = coarsest.buffer[i] * upWeights[0];
    }
  } else {
    upWeights[radiusLevels - 1] *= coarsestBlend;
    accumulator = new Float32Array(coarsest.buffer.length);
    for (let i = 0; i < accumulator.length; i++) {
      accumulator[i] = coarsest.buffer[i] * coarsestBlend;
    }
    for (let level = levels.length - 2; level >= 0; level--) {
      const target = levels[level];
      accumulator = upsampleAndCombine(
        target.buffer,
        target.width,
        target.height,
        accumulator,
        accWidth,
        accHeight,
        upWeights[level]
      );
      accWidth = target.width;
      accHeight = target.height;
    }
  }

  const bloom = new Float32Array(accumulator.length);
  for (let i = 0; i < bloom.length; i++) {
    bloom[i] = accumulator[i] * opts.intensity;
  }

  const composite = new Float32Array(source.length);
  for (let i = 0; i < source.length; i++) {
    composite[i] = source[i] + bloom[i];
  }

  return {
    enabled: true,
    composite,
    bloom,
    levels,
    mipSizes,
    downWeights: DOWN_WEIGHTS,
    upWeights,
  };
}
