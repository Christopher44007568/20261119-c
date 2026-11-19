const REFERENCE_STEPS = 2048;

export function analyticTransmittance(sigmaT, density, distance) {
  return Math.exp(-sigmaT * density * distance);
}

export function marchHomogeneousTransmittance(steps, sigmaT, density, distance) {
  const dt = distance / steps;
  let opticalDepth = 0;
  for (let i = 0; i < steps; i++) {
    opticalDepth += sigmaT * density * dt;
  }
  return Math.exp(-opticalDepth);
}

export function spotlightRadiance(position, light) {
  const lx = light.position[0] - position[0];
  const ly = light.position[1] - position[1];
  const lz = light.position[2] - position[2];
  const distanceSquared = lx * lx + ly * ly + lz * lz;
  const invDistance = 1 / Math.sqrt(distanceSquared);
  const cosAngle =
    (-lx * light.direction[0] - ly * light.direction[1] - lz * light.direction[2]) *
    invDistance;
  const cone = smoothstep(light.outerCos, light.innerCos, cosAngle);
  return light.intensity * cone / (distanceSquared + light.softening);
}

export function integrateSpotScattering(steps, config) {
  const { sigmaT, density, distance, light } = config;
  const dt = distance / steps;
  let transmittance = 1;
  let radiance = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const position = [
      config.origin[0] + config.direction[0] * t,
      config.origin[1] + config.direction[1] * t,
      config.origin[2] + config.direction[2] * t,
    ];
    const extinction = sigmaT * density;
    const stepTransmittance = Math.exp(-extinction * dt);
    radiance +=
      transmittance *
      (1 - stepTransmittance) *
      spotlightRadiance(position, light) *
      config.phase;
    transmittance *= stepTransmittance;
  }
  return { radiance, transmittance };
}

export function referenceConfig() {
  return {
    origin: [0, 2.2, 7.1],
    direction: [0, 0, -1],
    distance: 7.1,
    sigmaT: 0.24,
    density: 0.55,
    phase: 1 / (4 * Math.PI),
    light: {
      position: [-0.45, 4.35, -4.15],
      direction: normalize([0.05, -0.27, 0.96]),
      innerCos: Math.cos(11 * Math.PI / 180),
      outerCos: Math.cos(31 * Math.PI / 180),
      intensity: 26,
      softening: 0.18,
    },
  };
}

export function validationReport(steps, config = referenceConfig()) {
  const analytic = analyticTransmittance(config.sigmaT, config.density, config.distance);
  const marched = marchHomogeneousTransmittance(steps, config.sigmaT, config.density, config.distance);
  const result = integrateSpotScattering(steps, config);
  const reference = integrateSpotScattering(REFERENCE_STEPS, config).radiance;
  const transmittanceError = Math.abs(marched - analytic);
  const convergenceError = reference > 0 ? Math.abs(result.radiance - reference) / reference : 0;
  return {
    analyticTransmittance: analytic,
    marchedTransmittance: marched,
    transmittanceError,
    convergenceError,
    radiance: result.radiance,
    referenceRadiance: reference,
  };
}

export function upsampleDepthWeight(
  fullDistance,
  halfDistance,
  relativeSigma = 0.018,
  floorSigma = 0.028,
) {
  const sigma = Math.max(floorSigma, fullDistance * relativeSigma);
  const delta = Math.abs(halfDistance - fullDistance) / sigma;
  return 1 - smoothstep(0.38, 1.15, delta);
}

export function guidedUpsample(taps) {
  let weightSum = 0;
  let radiance = 0;
  for (const tap of taps) {
    const weight = tap.bilinearWeight * tap.depthWeight;
    weightSum += weight;
    radiance += tap.color * weight;
  }
  return {
    weightSum,
    color: weightSum > 1e-6 ? radiance / weightSum : 0,
  };
}

export function convergenceSeries(config = referenceConfig()) {
  const reference = integrateSpotScattering(REFERENCE_STEPS, config).radiance;
  return [16, 24, 32, 48, 64, 96, 128, 192].map((steps) => {
    const result = integrateSpotScattering(steps, config);
    return {
      steps,
      error: reference > 0 ? Math.abs(result.radiance - reference) / reference : 0,
    };
  });
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
