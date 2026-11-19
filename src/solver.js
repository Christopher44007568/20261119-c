import {
  EPSILON,
  add,
  applyLocalControls,
  boundingDiagonal,
  cloneVertices,
  cross,
  detectFlippedFaces,
  dot,
  length,
  reconcileControls,
  signedVolume,
  sub,
  topologyIssues
} from "./geometry.js";

export function volumeGradient(mesh, vertices) {
  const gradient = vertices.map(() => [0, 0, 0]);
  for (const [a, b, c] of mesh.faces) {
    const ga = cross(vertices[b], vertices[c]);
    const gb = cross(vertices[c], vertices[a]);
    const gc = cross(vertices[a], vertices[b]);
    for (let axis = 0; axis < 3; axis += 1) {
      gradient[a][axis] += ga[axis] / 6;
      gradient[b][axis] += gb[axis] / 6;
      gradient[c][axis] += gc[axis] / 6;
    }
  }
  return gradient;
}

function maxControlResidual(fixedTargets, positions) {
  let maximum = 0;
  for (const [vertex, target] of fixedTargets) {
    maximum = Math.max(maximum, length(sub(positions[vertex], target)));
  }
  return maximum;
}

function resultFailure(base, status, message, extra = {}) {
  return {
    ok: false,
    status,
    message,
    positions: cloneVertices(base),
    iterations: [],
    ...extra
  };
}

export function solveVolumeConstraint(
  mesh,
  startPositions,
  fixedVertices,
  targetVolume,
  options = {}
) {
  const positions = cloneVertices(startPositions);
  const fixed = fixedVertices instanceof Set ? fixedVertices : new Set(fixedVertices);
  const free = positions.map((_, index) => index).filter((index) => !fixed.has(index));
  const diagonal = Math.max(boundingDiagonal(positions), EPSILON);
  const relativeTolerance = options.relativeTolerance ?? 1e-8;
  const tolerance = Math.max(
    options.absoluteTolerance ?? 1e-10,
    relativeTolerance * Math.max(1, Math.abs(targetVolume))
  );
  const maxIterations = options.maxIterations ?? 30;
  const maxStep = options.maxStep ?? diagonal * 0.2;
  const fixedTargets =
    options.fixedTargets ??
    new Map([...fixed].map((vertex) => [vertex, positions[vertex].slice()]));

  let residual = signedVolume(mesh, positions) - targetVolume;
  const iterations = [];
  const summary = {
    initialResidual: residual,
    initialVolume: signedVolume(mesh, positions),
    targetVolume,
    tolerance,
    freeVertexCount: free.length,
    fixedVertexCount: fixed.size
  };

  if (Math.abs(residual) <= tolerance) {
    return {
      ok: true,
      status: "already-satisfied",
      message: "初始形状已满足体积约束，无需修正。",
      positions,
      iterations,
      summary
    };
  }
  if (free.length === 0) {
    return resultFailure(
      positions,
      "infeasible-controls",
      `所有顶点均被控制，但体积残差为 ${residual.toExponential(3)}，不存在可修正的自由度。`,
      { summary, iterations }
    );
  }

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const residualBefore = residual;
    const gradient = volumeGradient(mesh, positions);
    let denominator = 0;
    let gradientNorm = 0;

    for (const vertex of free) {
      const magnitudeSquared = dot(gradient[vertex], gradient[vertex]);
      denominator += magnitudeSquared;
      gradientNorm += magnitudeSquared;
    }

    if (denominator <= EPSILON * diagonal * diagonal) {
      return resultFailure(
        positions,
        "infeasible-controls",
        "自由顶点的体积梯度接近零，当前控制点组合无法继续修正体积。",
        { summary, iterations, finalResidual: residual }
      );
    }

    const step = positions.map(() => [0, 0, 0]);
    for (const vertex of free) {
      step[vertex] = [
        (-residual * gradient[vertex][0]) / denominator,
        (-residual * gradient[vertex][1]) / denominator,
        (-residual * gradient[vertex][2]) / denominator
      ];
    }

    let maxStepNorm = 0;
    for (const vertex of free) maxStepNorm = Math.max(maxStepNorm, length(step[vertex]));
    const stepClamp = maxStepNorm > maxStep ? maxStep / maxStepNorm : 1;
    if (stepClamp < 1) {
      for (const vertex of free) {
        step[vertex] = step[vertex].map((value) => value * stepClamp);
      }
    }

    let accepted = null;
    let alpha = 1;
    for (let lineSearch = 0; lineSearch < 24; lineSearch += 1) {
      const trial = positions.map((position, index) =>
        fixed.has(index)
          ? position
          : add(position, step[index].map((value) => value * alpha))
      );
      const trialResidual = signedVolume(mesh, trial) - targetVolume;
      const flipped = detectFlippedFaces(mesh, positions, trial);
      if (flipped.length === 0 && Math.abs(trialResidual) < Math.abs(residual)) {
        accepted = { trial, trialResidual, alpha, flipped };
        break;
      }
      alpha *= 0.5;
      if (alpha < 1e-7) break;
    }

    if (!accepted) {
      return resultFailure(
        positions,
        "infeasible-controls",
        "体积修正线搜索失败；继续修改会翻转面片，当前控制目标与体积约束不相容。",
        { summary, iterations, finalResidual: residual, gradientNorm }
      );
    }

    let maximumCorrection = 0;
    for (const vertex of free) {
      maximumCorrection = Math.max(maximumCorrection, length(step[vertex]) * accepted.alpha);
    }
    for (let index = 0; index < positions.length; index += 1) {
      positions[index] = accepted.trial[index];
    }
    residual = accepted.trialResidual;
    const controlResidual = maxControlResidual(fixedTargets, positions);

    iterations.push({
      iteration,
      residualBefore,
      residual,
      signedVolume: signedVolume(mesh, positions),
      maxCorrection: maximumCorrection,
      controlResidual,
      alpha: accepted.alpha,
      stepClamp
    });

    if (Math.abs(residual) <= tolerance) {
      return {
        ok: true,
        status: "converged",
        message: `体积约束在第 ${iteration} 轮收敛。`,
        positions,
        iterations,
        summary: { ...summary, finalResidual: residual, finalVolume: signedVolume(mesh, positions) }
      };
    }
  }

  return resultFailure(
    positions,
    "not-converged",
    `达到 ${maxIterations} 轮上限后体积残差仍为 ${residual.toExponential(3)}。`,
    { summary, iterations, finalResidual: residual }
  );
}

function preflightFailure(base, issues, extra = {}) {
  return {
    ok: false,
    stage: "preflight",
    status: "preflight-error",
    message: issues.map((issue) => issue.message).join(" "),
    issues,
    positions: cloneVertices(base),
    iterations: [],
    ...extra
  };
}

export function deformVolumePreserving(mesh, controls, options = {}) {
  const base = options.baseVertices ?? mesh.vertices;
  const diagonal = Math.max(boundingDiagonal(base), EPSILON);
  const topology = topologyIssues(mesh);
  if (topology.length > 0) {
    return preflightFailure(base, topology, { stage: "topology" });
  }

  const baseVolume = signedVolume(mesh, base);
  if (!Number.isFinite(baseVolume) || baseVolume <= EPSILON) {
    return preflightFailure(base, [{
      code: "invalid-orientation",
      message: `带符号体积为 ${baseVolume.toExponential(3)}；封闭网格必须采用外向绕向。`
    }]);
  }

  const reconciliation = reconcileControls(
    controls,
    base.length,
    options.controlTolerance ?? Math.max(1e-9, diagonal * 1e-9)
  );
  if (!reconciliation.ok) {
    return {
      ok: false,
      stage: "controls",
      status: "conflict",
      message: `${reconciliation.issues.map((issue) => issue.message).join(" ")} 已保留最后可行形状。`,
      issues: reconciliation.issues,
      positions: cloneVertices(base),
      iterations: []
    };
  }

  const radius = options.radius ?? diagonal * 0.34;
  const local = applyLocalControls(mesh, base, controls, radius);
  const flipped = detectFlippedFaces(mesh, base, local.positions);
  if (flipped.length > 0) {
    return preflightFailure(base, [{
      code: "flipped-face",
      message: `控制点位移使 ${flipped.length} 个面片翻转或塌缩，已在求解前终止。`,
      details: { flipped }
    }], { stage: "local-deformation", flippedFaces: flipped });
  }

  const targetVolume = options.targetVolume ?? baseVolume;
  const fixedTargets = new Map(
    reconciliation.controls.map((control) => [control.vertex, control.target.slice()])
  );
  const solved = solveVolumeConstraint(
    mesh,
    local.positions,
    new Set(fixedTargets.keys()),
    targetVolume,
    { ...options, fixedTargets }
  );

  if (!solved.ok) {
    return {
      ok: false,
      stage: "solve",
      status: solved.status,
      message: `${solved.message} 已保留最后可行形状。`,
      issues: [{
        code: solved.status,
        message: solved.message
      }],
      basePositions: cloneVertices(base),
      candidatePositions: cloneVertices(local.positions),
      positions: cloneVertices(base),
      iterations: solved.iterations ?? [],
      summary: solved.summary,
      finalResidual: solved.finalResidual
    };
  }

  return {
    ok: true,
    stage: "solved",
    status: solved.status,
    message: solved.message,
    positions: solved.positions,
    candidatePositions: local.positions,
    basePositions: cloneVertices(base),
    iterations: solved.iterations,
    summary: solved.summary,
    baseVolume,
    targetVolume,
    finalVolume: signedVolume(mesh, solved.positions),
    controlResidual: maxControlResidual(fixedTargets, solved.positions),
    controls: reconciliation.controls,
    issues: [],
    flippedFaces: []
  };
}
