'use strict';
/**
 * Height-map -> tangent-space normal-map reconstruction.
 *
 * Unified texture-coordinate / handedness convention
 * --------------------------------------------------
 * - Texture coordinates: u increases along image columns (right),
 *   v increases along image rows (down), matching row-major storage
 *   height[v * width + u].
 * - Per-texel tangent frame: T = +u, B = +v, N = T x B (right-handed).
 * - Geometric normal is derived ONLY from the (filtered) height gradient:
 *     dhdT = dH/du, dhdB = dH/dv   (world units, after heightScale)
 *     n = normalize(-dhdT, -dhdB, 1)
 * - Optional roughness map modulates ONLY the declared filter scale
 *   sigma(x) = radius + roughnessRadius * roughness(x); it never
 *   contributes direction. With radius = roughnessRadius = 0 the
 *   roughness map has exactly zero effect.
 * - Optional edge protection uses a bilateral (range-weighted) filter so
 *   smoothing does not bleed across height discontinuities.
 * - Packing to 8-bit RGB:
 *     R = 0.5 + 0.5*nx, B = 0.5 + 0.5*nz
 *     greenUp = true  (OpenGL): G = 0.5 - 0.5*ny
 *     greenUp = false (DirectX): G = 0.5 + 0.5*ny
 */

/**
 * Edge-preserving bilateral filter: spatial Gaussian of sigmaS texels
 * combined with a range Gaussian of sigmaR height units. Texels across
 * a height discontinuity contribute almost nothing, so smoothing does
 * not bleed across edges. Out-of-range texels are skipped (replicate
 * boundary would create false plateaus that fight the range weight).
 */
function bilateral2D(src, width, heightPx, sigmaS, sigmaR) {
  if (!(sigmaS > 0)) return Float64Array.from(src);
  const r = Math.max(1, Math.ceil(3 * sigmaS));
  const spatial = new Float64Array(2 * r + 1);
  const invS = 1 / (2 * sigmaS * sigmaS);
  for (let i = -r; i <= r; i++) spatial[i + r] = Math.exp(-i * i * invS);
  const invR = 1 / (2 * sigmaR * sigmaR);
  const dst = new Float64Array(src.length);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < width; x++) {
      const center = src[y * width + x];
      let acc = 0;
      let wsum = 0;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(heightPx - 1, y + r);
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      for (let yy = y0; yy <= y1; yy++) {
        const wy = spatial[yy - y + r];
        const row = yy * width;
        for (let xx = x0; xx <= x1; xx++) {
          const dh = src[row + xx] - center;
          const w = wy * spatial[xx - x + r] * Math.exp(-dh * dh * invR);
          acc += w * src[row + xx];
          wsum += w;
        }
      }
      dst[y * width + x] = wsum > 0 ? acc / wsum : center;
    }
  }
  return dst;
}

/**
 * Smooth the height field at one scale. Edge protection switches from a
 * plain Gaussian to a bilateral filter with range sigma edgeThreshold.
 */
function smoothHeight(src, width, heightPx, sigma, edgeProtect, edgeThreshold) {
  if (!(sigma > 0)) return Float64Array.from(src);
  if (edgeProtect) return bilateral2D(src, width, heightPx, sigma, edgeThreshold);
  return convolveSeparable(src, width, heightPx, gaussianKernel1D(sigma));
}

/**
 * Pre-filtered height fields at `levels` linearly spaced sigmas from 0
 * to sigmaMax, so a spatially varying filter scale can be interpolated
 * per texel between the two bracketing levels.
 */
function buildScaleSpace(src, width, heightPx, sigmaMax, levels, edgeProtect, edgeThreshold) {
  const space = new Array(levels);
  for (let i = 0; i < levels; i++) {
    const sigma = (sigmaMax * i) / (levels - 1);
    space[i] = smoothHeight(src, width, heightPx, sigma, edgeProtect, edgeThreshold);
  }
  return space;
}

/**
 * Normalized 1D Gaussian kernel for the given sigma (in texels).
 * sigma <= 0 yields the identity kernel [1].
 */
function gaussianKernel1D(sigma) {
  if (!(sigma > 0)) return Float64Array.of(1);
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float64Array(2 * r + 1);
  const inv = 1 / (2 * sigma * sigma);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-i * i * inv);
    k[i + r] = w;
    sum += w;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/**
 * Separable convolution with replicate (clamp-to-edge) boundary handling.
 * src is row-major Float64Array of length width * heightPx.
 */
function convolveSeparable(src, width, heightPx, kernel) {
  const r = (kernel.length - 1) >> 1;
  if (r === 0) return Float64Array.from(src);
  const tmp = new Float64Array(src.length);
  const dst = new Float64Array(src.length);
  for (let y = 0; y < heightPx; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        let xx = x + i;
        if (xx < 0) xx = 0;
        else if (xx >= width) xx = width - 1;
        acc += kernel[i + r] * src[row + xx];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < heightPx; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        let yy = y + i;
        if (yy < 0) yy = 0;
        else if (yy >= heightPx) yy = heightPx - 1;
        acc += kernel[i + r] * tmp[yy * width + x];
      }
      dst[row + x] = acc;
    }
  }
  return dst;
}

/**
 * Reconstruct tangent-space normals from a height map.
 *
 * @param {ArrayLike<number>} height  row-major height values, length width*heightPx
 * @param {number} width              texels per row (u axis)
 * @param {number} heightPx           rows (v axis)
 * @param {object} [options]
 * @param {number} [options.heightScale=1]      world height per unit value per texel
 * @param {number} [options.radius=0]           base Gaussian sigma, texels
 * @param {ArrayLike<number>} [options.roughness=null]  per-texel 0..1, same layout
 * @param {number} [options.roughnessRadius=0]  extra sigma at roughness=1, texels
 * @param {boolean} [options.edgeProtect=false] bilateral (edge-preserving) filter
 * @param {number} [options.edgeThreshold=0.1]  bilateral range sigma, height units
 * @param {boolean} [options.greenUp=true]      OpenGL packing; false = DirectX
 * @param {number} [options.levels=8]           scale-space levels for roughness
 * @returns {{normals: Float32Array, rgb: Uint8Array, width: number, height: number}}
 *   normals: xyz per texel in the unified tangent frame (unit length);
 *   rgb: packed 0..255 normal map applying the greenUp convention.
 */
function heightToNormals(height, width, heightPx, options = {}) {
  const {
    heightScale = 1,
    radius = 0,
    roughness = null,
    roughnessRadius = 0,
    edgeProtect = false,
    edgeThreshold = 0.1,
    greenUp = true,
    levels = 8,
  } = options;
  const n = width * heightPx;
  if (height.length !== n) throw new Error('height length mismatch');
  if (roughness && roughness.length !== n) throw new Error('roughness length mismatch');
  const src = Float64Array.from(height);

  const sigmaMax = radius + (roughness ? roughnessRadius : 0);
  let smoothed;
  if (sigmaMax <= 0) {
    smoothed = src;
  } else if (!roughness || roughnessRadius === 0) {
    smoothed = smoothHeight(src, width, heightPx, radius, edgeProtect, edgeThreshold);
  } else {
    const space = buildScaleSpace(src, width, heightPx, sigmaMax, levels, edgeProtect, edgeThreshold);
    smoothed = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const sigma = radius + roughnessRadius * roughness[i];
      const pos = (sigma / sigmaMax) * (levels - 1);
      const l0 = Math.min(levels - 2, Math.floor(pos));
      const frac = pos - l0;
      smoothed[i] = space[l0][i] * (1 - frac) + space[l0 + 1][i] * frac;
    }
  }

  const normals = new Float32Array(3 * n);
  const rgb = new Uint8Array(3 * n);
  const gSign = greenUp ? -1 : 1;
  for (let y = 0; y < heightPx; y++) {
    const row = y * width;
    const yUp = y > 0 ? row - width : row;
    const yDn = y < heightPx - 1 ? row + width : row;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const xL = x > 0 ? i - 1 : i;
      const xR = x < width - 1 ? i + 1 : i;
      const dhdx = 0.5 * (smoothed[xR] - smoothed[xL]) * heightScale;
      const dhdy = 0.5 * (smoothed[yDn + x] - smoothed[yUp + x]) * heightScale;
      const nx = -dhdx;
      const ny = -dhdy;
      const invLen = 1 / Math.hypot(nx, ny, 1);
      const o = 3 * i;
      normals[o] = nx * invLen;
      normals[o + 1] = ny * invLen;
      normals[o + 2] = invLen;
      rgb[o] = Math.round(255 * (0.5 + 0.5 * normals[o]));
      rgb[o + 1] = Math.round(255 * (0.5 + 0.5 * gSign * normals[o + 1]));
      rgb[o + 2] = Math.round(255 * (0.5 + 0.5 * normals[o + 2]));
    }
  }
  return { normals, rgb, width, height: heightPx };
}

module.exports = {
  gaussianKernel1D,
  convolveSeparable,
  bilateral2D,
  smoothHeight,
  buildScaleSpace,
  heightToNormals,
};
