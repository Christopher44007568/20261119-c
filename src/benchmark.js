import { makeSphere, makeOpenSheet, meshStats } from "./geometry.js";
import { windingNumber, spherePointInfo } from "./winding.js";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function compareClosedSphere(mesh, {
  samples = 220,
  extent = 1.42,
  surfaceBuffer = 0.025,
  surfaceEpsilon = 0.008,
  seed = 0x51f15e,
} = {}) {
  const random = seededRandom(seed);
  const radius = mesh.analytic?.radius || 1;
  const inward = mesh.kind === "sphere-flipped";
  let tested = 0;
  let agreement = 0;
  let signedAgreement = 0;
  let errorSum = 0;
  let maxError = 0;
  let skipped = 0;

  for (let sample = 0; sample < samples; sample += 1) {
    const point = [
      (random() * 2 - 1) * extent,
      (random() * 2 - 1) * extent,
      (random() * 2 - 1) * extent,
    ];
    const analytic = spherePointInfo(point, radius);
    if (Math.abs(analytic.signedGap) < surfaceBuffer) {
      skipped += 1;
      continue;
    }
    const result = windingNumber(mesh, point);
    if (result.nearestDistance <= surfaceEpsilon) {
      skipped += 1;
      continue;
    }
    const predictedInside = Math.abs(result.winding) >= 0.5;
    const signedExpected = analytic.inside ? (inward ? -1 : 1) : 0;
    const signedPredictedInside = inward ? result.winding < 0 : result.winding > 0;
    const error = Math.abs(result.winding - signedExpected);
    tested += 1;
    if (predictedInside === analytic.inside) agreement += 1;
    if (!analytic.inside || signedPredictedInside === analytic.inside) signedAgreement += 1;
    errorSum += error;
    maxError = Math.max(maxError, error);
  }

  return {
    name: mesh.name,
    kind: mesh.kind,
    tested,
    skipped,
    containmentAgreement: tested ? agreement / tested : 0,
    signedAgreement: tested ? signedAgreement / tested : 0,
    meanWindingError: tested ? errorSum / tested : 0,
    maxWindingError: maxError,
    orientation: inward ? "inward" : "outward",
  };
}

export function inspectOpenSheet(mesh, { surfaceEpsilon = 0.008 } = {}) {
  const probes = [
    [0.16, 0.1, -0.22],
    [-0.38, 0.13, 0.26],
    [0.45, 0.16, 0.31],
    [-0.18, 0.21, -0.42],
  ];
  let fractional = 0;
  let signPairs = 0;
  let maxMagnitude = 0;
  const values = [];

  for (const [x, z] of probes) {
    const above = windingNumber(mesh, [x, 0.08, z]);
    const below = windingNumber(mesh, [x, -0.08, z]);
    if (above.nearestDistance > surfaceEpsilon && below.nearestDistance > surfaceEpsilon) {
      if (Math.abs(above.winding) > 0.045 && Math.abs(above.winding) < 0.955) fractional += 1;
      if (Math.sign(above.winding) !== Math.sign(below.winding)) signPairs += 1;
      maxMagnitude = Math.max(maxMagnitude, Math.abs(above.winding), Math.abs(below.winding));
      values.push({ above: above.winding, below: below.winding });
    }
  }

  return {
    name: mesh.name,
    kind: "sheet",
    tested: values.length,
    fractional,
    signPairs,
    maxMagnitude,
    values,
    analyticEquivalent: false,
  };
}

export function runBuiltInBenchmarks({
  surfaceEpsilon = 0.008,
  valueBand = 0.035,
} = {}) {
  const closed = makeSphere();
  const flipped = makeSphere({ flipped: true });
  const sheet = makeOpenSheet();
  return {
    closed: {
      ...compareClosedSphere(closed, { surfaceEpsilon }),
      stats: meshStats(closed),
    },
    flipped: {
      ...compareClosedSphere(flipped, { surfaceEpsilon, seed: 0x8f31c2 }),
      stats: meshStats(flipped),
    },
    sheet: {
      ...inspectOpenSheet(sheet, { surfaceEpsilon }),
      stats: meshStats(sheet),
    },
    valueBand,
  };
}
