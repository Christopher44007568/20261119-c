// HDR test scene generator.
//
// The scene contains exactly two emitters on an otherwise dark background:
//   1. one compact bright point (a narrow Gaussian spot)
//   2. one straight bright horizontal line (a thin Gaussian strip)
// A dim gray patch (luminance below the bloom threshold) is also included so
// tests can prove that sub-threshold content survives composite untouched.

function setPixel(buffer, width, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= width) return;
  const index = (y * width + x) * 3;
  buffer[index] += r;
  buffer[index + 1] += g;
  buffer[index + 2] += b;
}

export function makeScene(width, height) {
  const buffer = new Float32Array(width * height * 3);

  // Dim gray reference patch, luminance 0.3 in every channel (< threshold 1).
  const patchX0 = Math.floor(width * 0.06);
  const patchX1 = Math.floor(width * 0.2);
  const patchY0 = Math.floor(height * 0.72);
  const patchY1 = Math.floor(height * 0.9);
  for (let y = patchY0; y < patchY1; y++) {
    for (let x = patchX0; x < patchX1; x++) {
      const index = (y * width + x) * 3;
      buffer[index] = 0.3;
      buffer[index + 1] = 0.3;
      buffer[index + 2] = 0.3;
    }
  }

  // Single bright point: Gaussian spot whose sigma is a fixed fraction of the
  // viewport, so the emitter itself scales identically across resolutions.
  const pointX = width * 0.32;
  const pointY = height * 0.38;
  const pointSigma = Math.max(1, height * 0.01);
  const pointPeak = 8;
  const reach = Math.ceil(pointSigma * 3);
  for (let y = Math.floor(pointY) - reach; y <= Math.floor(pointY) + reach; y++) {
    for (let x = Math.floor(pointX) - reach; x <= Math.floor(pointX) + reach; x++) {
      const dx = x + 0.5 - pointX;
      const dy = y + 0.5 - pointY;
      const energy =
        pointPeak *
        Math.exp(-(dx * dx + dy * dy) / (2 * pointSigma * pointSigma));
      setPixel(buffer, width, x, y, energy, energy * 0.92, energy * 0.75);
    }
  }

  // One bright horizontal line: Gaussian across the line, constant along its
  // length, with viewport-relative thickness and fixed intensity 6.
  const lineY = height * 0.68;
  const lineX0 = width * 0.45;
  const lineX1 = width * 0.92;
  const lineSigma = Math.max(1, height * 0.008);
  const linePeak = 6;
  const lineReach = Math.ceil(lineSigma * 3);
  for (let y = Math.floor(lineY) - lineReach; y <= Math.floor(lineY) + lineReach; y++) {
    const dy = y + 0.5 - lineY;
    const across =
      linePeak * Math.exp(-(dy * dy) / (2 * lineSigma * lineSigma));
    for (let x = Math.floor(lineX0); x < Math.floor(lineX1); x++) {
      setPixel(buffer, width, x, y, across, across, across * 1.05);
    }
  }

  return {
    buffer,
    width,
    height,
    emitters: {
      point: { x: pointX, y: pointY, sigma: pointSigma, peak: pointPeak },
      line: {
        x0: lineX0,
        x1: lineX1,
        y: lineY,
        sigma: lineSigma,
        peak: linePeak,
      },
    },
  };
}
