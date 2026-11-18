// Water-surface perturbation + reflection-coordinate error metrics.
// The calm plane y=0 stays the geometric reference; waves only offset the
// reflection-texture lookup, and the offset is clamped so the sample can
// never leave the water quad's screen-space footprint.

// Analytic slope of a few travelling sine waves (visual perturbation only,
// the water geometry stays the calm reference plane).
export function waveSlope(x, z, t) {
  let dx = 0;
  let dz = 0;
  // [dirX, dirZ, freq, speed, amp]
  const waves = [
    [1.0, 0.3, 0.9, 1.1, 0.045],
    [-0.6, 1.0, 1.7, 1.6, 0.028],
    [0.8, -0.7, 3.1, 2.3, 0.014],
  ];
  for (const [ux, uz, f, s, a] of waves) {
    const ph = (x * ux + z * uz) * f + t * s;
    const c = Math.cos(ph) * f * a;
    dx += ux * c;
    dz += uz * c;
  }
  return [dx, dz];
}

// UV offset produced by the perturbation, in reflection-texture UV units.
export function perturbOffset(x, z, t, strength) {
  const [dx, dz] = waveSlope(x, z, t);
  return [dx * strength, dz * strength];
}

// Clamp a UV into the water quad's screen-space AABB so the perturbed
// sample always lands on texels the water actually covers.
export function clampToFootprint(uv, min, max) {
  return [
    Math.min(Math.max(uv[0], min[0]), max[0]),
    Math.min(Math.max(uv[1], min[1]), max[1]),
  ];
}

// Screen-space AABB (UV) of the water quad corners, clamped to [0,1].
export function waterFootprint(projectUV, corners) {
  const min = [1, 1];
  const max = [0, 0];
  for (const c of corners) {
    const uv = projectUV(c);
    if (!uv) continue;
    min[0] = Math.min(min[0], uv[0]);
    min[1] = Math.min(min[1], uv[1]);
    max[0] = Math.max(max[0], uv[0]);
    max[1] = Math.max(max[1], uv[1]);
  }
  if (min[0] > max[0]) return { min: [0, 0], max: [1, 1] };
  return {
    min: [Math.max(0, min[0]), Math.max(0, min[1])],
    max: [Math.min(1, max[0]), Math.min(1, max[1])],
  };
}

// Reflection-coordinate error vs. the calm-water reference uv0, in pixels.
// perturb=false must give exactly zero error (geometric reference).
export function reflectionError(opts) {
  const {
    projectUV, corners, res, time, strength, perturb, grid = 24,
  } = opts;
  const fp = waterFootprint(projectUV, corners);
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[2]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const z0 = Math.min(...zs), z1 = Math.max(...zs);
  let sum = 0, maxErr = 0, n = 0, clampedCount = 0, outside = 0, offscreen = 0;
  for (let i = 0; i <= grid; i++) {
    for (let j = 0; j <= grid; j++) {
      const x = x0 + (x1 - x0) * (i / grid);
      const z = z0 + (z1 - z0) * (j / grid);
      const uv0 = projectUV([x, 0, z]);
      if (!uv0) continue;
      // only on-screen water pixels have a meaningful reflection coordinate
      if (uv0[0] < 0 || uv0[0] > 1 || uv0[1] < 0 || uv0[1] > 1) {
        offscreen++;
        continue;
      }
      let uv = uv0;
      if (perturb) {
        const o = perturbOffset(x, z, time, strength);
        uv = clampToFootprint([uv0[0] + o[0], uv0[1] + o[1]], fp.min, fp.max);
        if (uv[0] !== uv0[0] + o[0] || uv[1] !== uv0[1] + o[1]) clampedCount++;
      }
      if (uv[0] < fp.min[0] - 1e-6 || uv[0] > fp.max[0] + 1e-6 ||
          uv[1] < fp.min[1] - 1e-6 || uv[1] > fp.max[1] + 1e-6) outside++;
      const ex = (uv[0] - uv0[0]) * res[0];
      const ey = (uv[1] - uv0[1]) * res[1];
      const e = Math.hypot(ex, ey);
      sum += e;
      if (e > maxErr) maxErr = e;
      n++;
    }
  }
  return {
    mean: n ? sum / n : 0,
    max: maxErr,
    samples: n,
    clampedCount,
    outside,
    offscreen,
    footprint: fp,
  };
}
