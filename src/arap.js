import { buildEdges, meshComponents } from "./mesh.js";

export const STOP_LABELS = {
  energy_and_rigid_tolerance: "能量与刚性残差达到阈值",
  energy_tolerance: "能量变化低于阈值",
  rigid_tolerance: "局部刚性残差低于阈值",
  max_iterations: "达到最大迭代次数",
  missing_constraints: "缺少固定约束，未执行求解",
};

function positionAt(positions, index) {
  return { x: positions[index * 2], y: positions[index * 2 + 1] };
}

function setPosition(positions, index, x, y) {
  positions[index * 2] = x;
  positions[index * 2 + 1] = y;
}

function collectAnchors(mesh, fixedVertices, target, anchorPositions) {
  const anchors = new Map();
  for (const index of fixedVertices) {
    const source = anchorPositions?.get?.(index);
    anchors.set(index, source ? { x: source.x, y: source.y } : positionAt(mesh.rest, index));
  }
  if (target && Number.isInteger(target.index)) {
    anchors.set(target.index, { x: target.x, y: target.y });
  }
  return anchors;
}

export function analyzeConstraints(mesh, { fixedVertices = mesh.fixed, target = null } = {}) {
  const fixedSet = fixedVertices instanceof Set ? fixedVertices : new Set(fixedVertices);
  const components = meshComponents(mesh).map((vertices, componentIndex) => {
    const anchors = vertices.filter(
      (index) => fixedSet.has(index) || target?.index === index,
    );
    return {
      componentIndex,
      vertices,
      size: vertices.length,
      anchorIndices: anchors,
      constrained: anchors.length > 0,
      status: anchors.length > 0 ? "constrained" : "missing_constraints",
    };
  });
  const skipped = components.filter((component) => !component.constrained);
  return {
    components,
    constrainedCount: components.length - skipped.length,
    skipped,
    allComponentsConstrained: skipped.length === 0,
  };
}

export function computeRotations(mesh, positions, edges) {
  const count = mesh.rest.length / 2;
  const dot = new Float64Array(count);
  const cross = new Float64Array(count);
  for (const edge of edges) {
    const ax = positions[edge.a * 2];
    const ay = positions[edge.a * 2 + 1];
    const bx = positions[edge.b * 2];
    const by = positions[edge.b * 2 + 1];
    const dqx = bx - ax;
    const dqy = by - ay;
    const dpx = mesh.rest[edge.b * 2] - mesh.rest[edge.a * 2];
    const dpy = mesh.rest[edge.b * 2 + 1] - mesh.rest[edge.a * 2 + 1];
    const edgeDot = dpx * dqx + dpy * dqy;
    const edgeCross = dpx * dqy - dpy * dqx;
    dot[edge.a] += edge.weight * edgeDot;
    dot[edge.b] += edge.weight * edgeDot;
    cross[edge.a] += edge.weight * edgeCross;
    cross[edge.b] += edge.weight * edgeCross;
  }
  const rotations = new Float64Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    const angle = Math.atan2(cross[index], dot[index]);
    rotations[index * 2] = Math.cos(angle);
    rotations[index * 2 + 1] = Math.sin(angle);
  }
  return rotations;
}

export function evaluatePositions(mesh, positions, rotations = null, edges = buildEdges(mesh)) {
  const activeRotations = rotations || computeRotations(mesh, positions, edges);
  let energy = 0;
  let rigidSquared = 0;
  let weightSum = 0;
  let maxRigid = 0;
  let maxStretch = 0;

  for (const edge of edges) {
    const a = edge.a;
    const b = edge.b;
    const w = edge.weight;
    const dqx = positions[a * 2] - positions[b * 2];
    const dqy = positions[a * 2 + 1] - positions[b * 2 + 1];
    const dpx = mesh.rest[a * 2] - mesh.rest[b * 2];
    const dpy = mesh.rest[a * 2 + 1] - mesh.rest[b * 2 + 1];

    const ca = activeRotations[a * 2];
    const sa = activeRotations[a * 2 + 1];
    const cb = activeRotations[b * 2];
    const sb = activeRotations[b * 2 + 1];
    const ac = (ca + cb) * 0.5;
    const as = (sa + sb) * 0.5;
    const rx = ac * dpx - as * dpy;
    const ry = as * dpx + ac * dpy;
    const globalError = (dqx - rx) ** 2 + (dqy - ry) ** 2;
    energy += w * globalError;

    const rax = ca * dpx - sa * dpy;
    const ray = sa * dpx + ca * dpy;
    const rbx = cb * dpx - sb * dpy;
    const rby = sb * dpx + cb * dpy;
    const errorA = (dqx - rax) ** 2 + (dqy - ray) ** 2;
    const errorB = (dqx - rbx) ** 2 + (dqy - rby) ** 2;
    rigidSquared += w * (errorA + errorB);
    maxRigid = Math.max(maxRigid, Math.sqrt(Math.max(errorA, errorB)));
    weightSum += w;

    const restLength = Math.hypot(dpx, dpy);
    if (restLength > 1e-12) {
      maxStretch = Math.max(maxStretch, Math.hypot(dqx, dqy) / restLength);
    }
  }

  return {
    energy,
    rigidEnergy: rigidSquared * 0.5,
    rigidRms: Math.sqrt(rigidSquared / Math.max(2 * weightSum, 1e-12)),
    rigidMax: maxRigid,
    maxStretch,
  };
}

function createLinearSystem(mesh, edges, activeVertices, anchors) {
  const count = mesh.rest.length / 2;
  const active = new Uint8Array(count);
  for (const index of activeVertices) active[index] = 1;

  const freeIndex = new Int32Array(count);
  freeIndex.fill(-1);
  const freeVertices = [];
  for (const index of activeVertices) {
    if (anchors.has(index)) continue;
    freeIndex[index] = freeVertices.length;
    freeVertices.push(index);
  }

  const diagonal = new Float64Array(freeVertices.length);
  const anchorX = new Float64Array(freeVertices.length);
  const anchorY = new Float64Array(freeVertices.length);
  const entries = Array.from({ length: freeVertices.length }, () => []);

  for (const edge of edges) {
    if (!active[edge.a] || !active[edge.b]) continue;
    const fa = freeIndex[edge.a];
    const fb = freeIndex[edge.b];
    if (fa >= 0) {
      diagonal[fa] += edge.weight;
      if (fb >= 0) entries[fa].push(fb, edge.weight);
      else {
        const anchor = anchors.get(edge.b);
        anchorX[fa] += edge.weight * anchor.x;
        anchorY[fa] += edge.weight * anchor.y;
      }
    }
    if (fb >= 0) {
      diagonal[fb] += edge.weight;
      if (fa >= 0) entries[fb].push(fa, edge.weight);
      else {
        const anchor = anchors.get(edge.a);
        anchorX[fb] += edge.weight * anchor.x;
        anchorY[fb] += edge.weight * anchor.y;
      }
    }
  }

  const matvec = (vector) => {
    const result = new Float64Array(freeVertices.length);
    for (let row = 0; row < freeVertices.length; row += 1) {
      let value = diagonal[row] * vector[row];
      const rowEntries = entries[row];
      for (let entry = 0; entry < rowEntries.length; entry += 2) {
        value -= rowEntries[entry + 1] * vector[rowEntries[entry]];
      }
      result[row] = value;
    }
    return result;
  };

  return { freeVertices, freeIndex, diagonal, anchorX, anchorY, matvec };
}

function dotProduct(a, b) {
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += a[index] * b[index];
  return total;
}

function conjugateGradient(system, rhs, initial, tolerance = 1e-10) {
  const size = rhs.length;
  const x = Float64Array.from(initial);
  const residual = Float64Array.from(rhs);
  const product = system.matvec(x);
  for (let index = 0; index < size; index += 1) residual[index] -= product[index];
  const z = new Float64Array(size);
  const direction = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    z[index] = residual[index] / Math.max(system.diagonal[index], 1e-12);
    direction[index] = z[index];
  }
  let rz = dotProduct(residual, z);
  const rhsNorm = Math.sqrt(dotProduct(rhs, rhs));
  const threshold = tolerance * Math.max(rhsNorm, 1);
  const maxIterations = Math.max(60, Math.min(600, size * 4));

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const applied = system.matvec(direction);
    const denominator = dotProduct(direction, applied);
    if (Math.abs(denominator) < 1e-24) break;
    const alpha = rz / denominator;
    let residualSquared = 0;
    for (let index = 0; index < size; index += 1) {
      x[index] += alpha * direction[index];
      residual[index] -= alpha * applied[index];
      residualSquared += residual[index] ** 2;
    }
    if (Math.sqrt(residualSquared) <= threshold) break;
    for (let index = 0; index < size; index += 1) {
      z[index] = residual[index] / Math.max(system.diagonal[index], 1e-12);
    }
    const nextRz = dotProduct(residual, z);
    const beta = nextRz / rz;
    for (let index = 0; index < size; index += 1) {
      direction[index] = z[index] + beta * direction[index];
    }
    rz = nextRz;
  }
  return x;
}

function applyAnchors(positions, anchors) {
  for (const [index, point] of anchors) setPosition(positions, index, point.x, point.y);
}

function anchorDrift(positions, anchors) {
  let maximum = 0;
  for (const [index, point] of anchors) {
    maximum = Math.max(
      maximum,
      Math.hypot(positions[index * 2] - point.x, positions[index * 2 + 1] - point.y),
    );
  }
  return maximum;
}

function buildGlobalRHS(mesh, edges, rotations, system) {
  const rhs = Float64Array.from(system.anchorX);
  for (let index = 0; index < system.anchorY.length; index += 1) {
    rhs[index] = system.anchorX[index];
  }
  const rhsY = Float64Array.from(system.anchorY);
  for (const edge of edges) {
    const fa = system.freeIndex[edge.a];
    const fb = system.freeIndex[edge.b];
    if (fa < 0 && fb < 0) continue;
    const ca = rotations[edge.a * 2];
    const sa = rotations[edge.a * 2 + 1];
    const cb = rotations[edge.b * 2];
    const sb = rotations[edge.b * 2 + 1];
    const ac = (ca + cb) * 0.5;
    const as = (sa + sb) * 0.5;
    const dpx = mesh.rest[edge.a * 2] - mesh.rest[edge.b * 2];
    const dpy = mesh.rest[edge.a * 2 + 1] - mesh.rest[edge.b * 2 + 1];
    const rx = ac * dpx - as * dpy;
    const ry = as * dpx + ac * dpy;
    if (fa >= 0) {
      rhs[fa] += edge.weight * rx;
      rhsY[fa] += edge.weight * ry;
    }
    if (fb >= 0) {
      rhs[fb] -= edge.weight * rx;
      rhsY[fb] -= edge.weight * ry;
    }
  }
  return { rhs, rhsY };
}

function solveSystemPair(system, rhs, rhsY, initial) {
  const x = conjugateGradient(system, rhs, initial.x);
  const y = conjugateGradient(system, rhsY, initial.y);
  return { x, y };
}

function commitFreePositions(positions, system, solution) {
  for (let free = 0; free < system.freeVertices.length; free += 1) {
    const index = system.freeVertices[free];
    positions[index * 2] = solution.x[free];
    positions[index * 2 + 1] = solution.y[free];
  }
}

function initialFreePositions(positions, system) {
  const x = new Float64Array(system.freeVertices.length);
  const y = new Float64Array(system.freeVertices.length);
  for (let free = 0; free < system.freeVertices.length; free += 1) {
    const index = system.freeVertices[free];
    x[free] = positions[index * 2];
    y[free] = positions[index * 2 + 1];
  }
  return { x, y };
}

function activeVerticesFor(report) {
  return report.components
    .filter((component) => component.constrained)
    .flatMap((component) => component.vertices);
}

function stopForIteration(iteration, energy, previousEnergy, rigidRms, options) {
  const relativeChange =
    previousEnergy === Infinity
      ? Infinity
      : Math.abs(previousEnergy - energy) / Math.max(Math.abs(previousEnergy), 1);
  const energyConverged =
    iteration >= options.minIterations && relativeChange <= options.energyTolerance;
  const rigidConverged = rigidRms <= options.rigidTolerance;
  if (energyConverged && rigidConverged) return "energy_and_rigid_tolerance";
  if (energyConverged) return "energy_tolerance";
  if (iteration >= options.minIterations && rigidConverged) return "rigid_tolerance";
  if (iteration >= options.maxIterations) return "max_iterations";
  return null;
}

export function* arapIterations(mesh, options = {}) {
  const fixedVertices = options.fixedVertices ?? mesh.fixed;
  const anchors = collectAnchors(mesh, fixedVertices, options.target, options.anchorPositions);
  const report = analyzeConstraints(mesh, { fixedVertices, target: options.target });
  const edges = buildEdges(mesh);
  const positions = options.positions
    ? Float64Array.from(options.positions)
    : Float64Array.from(mesh.positions);
  applyAnchors(positions, anchors);

  const settings = {
    maxIterations: Math.max(1, Number(options.maxIterations) || 36),
    minIterations: Math.max(1, Number(options.minIterations) || 2),
    energyTolerance: Math.max(0, Number(options.energyTolerance) || 1e-7),
    rigidTolerance: Math.max(0, Number(options.rigidTolerance) || 5e-4),
    linearTolerance: Math.max(1e-14, Number(options.linearTolerance) || 1e-10),
  };

  const initialRotations = computeRotations(mesh, positions, edges);
  const initialMetrics = evaluatePositions(mesh, positions, initialRotations, edges);
  const activeVertices = activeVerticesFor(report);

  if (activeVertices.length === 0) {
    yield {
      ...initialMetrics,
      iteration: 0,
      positions: Float64Array.from(positions),
      rotations: initialRotations,
      anchorDrift: anchorDrift(positions, anchors),
      initialEnergy: initialMetrics.energy,
      initialRigidRms: initialMetrics.rigidRms,
      relativeEnergyChange: Infinity,
      componentReport: report,
      stopReason: "missing_constraints",
      stopLabel: STOP_LABELS.missing_constraints,
      done: true,
    };
    return;
  }

  const system = createLinearSystem(mesh, edges, activeVertices, anchors);
  let previousEnergy = Infinity;
  let lastStep = null;

  for (let iteration = 1; iteration <= settings.maxIterations; iteration += 1) {
    const rotations = computeRotations(mesh, positions, edges);
    const rightHandSide = buildGlobalRHS(mesh, edges, rotations, system);
    const solution = solveSystemPair(
      system,
      rightHandSide.rhs,
      rightHandSide.rhsY,
      initialFreePositions(positions, system),
    );
    commitFreePositions(positions, system, solution);
    applyAnchors(positions, anchors);

    const metrics = evaluatePositions(mesh, positions, rotations, edges);
    const relativeEnergyChange =
      previousEnergy === Infinity
        ? Infinity
        : Math.abs(previousEnergy - metrics.energy) / Math.max(Math.abs(previousEnergy), 1);
    const stopReason = stopForIteration(
      iteration,
      metrics.energy,
      previousEnergy,
      metrics.rigidRms,
      settings,
    );
    const step = {
      ...metrics,
      iteration,
      positions: Float64Array.from(positions),
      rotations: Float64Array.from(rotations),
      anchorDrift: anchorDrift(positions, anchors),
      initialEnergy: initialMetrics.energy,
      initialRigidRms: initialMetrics.rigidRms,
      relativeEnergyChange,
      componentReport: report,
      stopReason,
      stopLabel: stopReason ? STOP_LABELS[stopReason] : null,
      done: Boolean(stopReason),
    };
    yield step;
    lastStep = step;
    previousEnergy = metrics.energy;
  }

  if (!lastStep) {
    throw new Error("ARAP session produced no iterations");
  }
}

export function runARAP(mesh, options = {}) {
  const history = [];
  let last = null;
  for (const step of arapIterations(mesh, options)) {
    history.push(step);
    last = step;
  }
  return { ...last, history };
}

export function solveLaplacian(mesh, options = {}) {
  const fixedVertices = options.fixedVertices ?? mesh.fixed;
  const anchors = collectAnchors(mesh, fixedVertices, options.target, options.anchorPositions);
  const report = analyzeConstraints(mesh, { fixedVertices, target: options.target });
  const edges = buildEdges(mesh);
  const positions = options.positions
    ? Float64Array.from(options.positions)
    : Float64Array.from(mesh.rest);
  applyAnchors(positions, anchors);
  const activeVertices = activeVerticesFor(report);

  if (activeVertices.length > 0) {
    const system = createLinearSystem(mesh, edges, activeVertices, anchors);
    const rhs = Float64Array.from(system.anchorX);
    const rhsY = Float64Array.from(system.anchorY);
    const solution = solveSystemPair(
      system,
      rhs,
      rhsY,
      initialFreePositions(positions, system),
    );
    commitFreePositions(positions, system, solution);
    applyAnchors(positions, anchors);
  }

  const rotations = computeRotations(mesh, positions, edges);
  const metrics = evaluatePositions(mesh, positions, rotations, edges);
  return {
    ...metrics,
    positions,
    rotations,
    anchorDrift: anchorDrift(positions, anchors),
    componentReport: report,
    stopReason: activeVertices.length > 0 ? "laplacian_reference" : "missing_constraints",
  };
}
