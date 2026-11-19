import { SecondaryChain, V } from "./physics.js";
import { SceneRenderer, drawEnergyScope } from "./renderer.js";

const DEG = Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => {
  const value = clamp(t, 0, 1);
  return value * value * (3 - 2 * value);
};

const SHAPES = {
  braid: {
    label: "辫子链",
    segments: 12,
    restLength: 0.218,
    nodeRadius: 0.058,
  },
  pendant: {
    label: "吊坠链",
    segments: 7,
    restLength: 0.268,
    nodeRadius: 0.064,
  },
};

const TRAJECTORY_LABELS = {
  pendulum: "PENDULUM",
  figure8: "FIGURE 8",
  orbit: "ORBIT",
};

const state = {
  shape: "braid",
  iterations: 8,
  hz: 120,
  damping: 1.6,
  bendDeg: 52,
  speed: 1,
  trajectory: "figure8",
  teleportPolicy: "reset",
  paused: false,
  overlays: {
    velocity: true,
    cones: true,
    contacts: true,
    trail: true,
  },
  phase: 0.18,
  simTime: 0,
  accumulator: 0,
  rootTrail: [],
  energyHistory: [],
  historyTimer: 0,
  lastEnergySample: 0,
  telemetryTimer: 0,
  hold: null,
  resume: null,
  experiment: {
    kind: null,
    startEnergy: 0,
    markerIndex: null,
    result: null,
    startedAt: 0,
  },
};

const dom = {};
const ids = [
  "sceneCanvas",
  "stageTitle",
  "viewShapeLabel",
  "solverBadge",
  "stepBadge",
  "runState",
  "fpsReadout",
  "lengthErrorReadout",
  "lengthErrorPercent",
  "collisionReadout",
  "collisionDetail",
  "driverSpeedReadout",
  "tipSpeedReadout",
  "energyReadout",
  "energyTrend",
  "contactBadge",
  "chainLengthBadge",
  "teleportBadge",
  "driverStatus",
  "contactCallout",
  "contactLabel",
  "solverState",
  "iterationReadout",
  "stepReadout",
  "bendReadout",
  "dampingReadout",
  "trajectoryReadout",
  "speedReadout",
  "policyNote",
  "pauseLabel",
  "pauseIconPath",
  "energyCanvas",
  "scopeRange",
  "decayReadout",
  "scopeState",
  "stopTestBtn",
  "rotateTestBtn",
  "trailToggle",
  "dragHint",
];
for (const id of ids) dom[id] = document.getElementById(id);

function trajectoryPoint(mode, phase) {
  if (mode === "pendulum") {
    const swing = Math.cos(phase);
    return [
      swing * 0.94,
      1.61 + Math.sin(phase * 2.3) * 0.055,
      0.39 + Math.sin(phase * 1.3) * 0.18,
    ];
  }
  if (mode === "orbit") {
    return [
      Math.cos(phase * 1.2) * 0.99,
      1.61 + Math.sin(phase * 2.8) * 0.045,
      0.36 + Math.sin(phase * 1.2) * 0.63,
    ];
  }
  return [
    Math.cos(phase * 0.94) * 0.93,
    1.61 + Math.sin(phase * 1.88) * 0.06,
    0.36 + Math.sin(phase * 1.88) * 0.47,
  ];
}

function buildChain(shape, root) {
  const config = SHAPES[shape];
  const chain = new SecondaryChain({
    segments: config.segments,
    restLength: config.restLength,
    nodeRadius: config.nodeRadius,
    sphere: { center: [0, 0.15, 0], radius: 1.05 },
    linearDamping: state.damping,
    maxBend: state.bendDeg * DEG,
    collisionFriction: 0.38,
    teleportDistance: 0.58,
  });
  chain.reset(root, V.normalize([0.08, -1, 0.06]));
  return chain;
}

let chain = buildChain(state.shape, trajectoryPoint(state.trajectory, state.phase));
const renderer = new SceneRenderer(dom.sceneCanvas, chain, {
  onCameraChange: () => {},
});

function setActive(container, activeButton) {
  if (!container) return;
  for (const button of container.querySelectorAll("button")) {
    button.classList.toggle("is-active", button === activeButton);
    button.setAttribute("aria-pressed", button === activeButton ? "true" : "false");
  }
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function updateShapeReadouts() {
  const config = SHAPES[state.shape];
  dom.stageTitle.textContent = config.label;
  dom.viewShapeLabel.textContent = `${state.shape === "braid" ? "BRAID" : "PENDANT"} / ${config.segments} BONES`;
  dom.chainLengthBadge.textContent = (config.segments * config.restLength).toFixed(2);
}

function resetTelemetry() {
  state.rootTrail = [];
  state.energyHistory = [];
  state.historyTimer = 0;
  state.experiment = {
    kind: null,
    startEnergy: 0,
    markerIndex: null,
    result: null,
    startedAt: state.simTime,
  };
  dom.stopTestBtn.classList.remove("is-running");
  dom.rotateTestBtn.classList.remove("is-running");
  document.getElementById("quickStopBtn").classList.remove("is-running");
  document.getElementById("quickRotateBtn").classList.remove("is-running");
  dom.scopeState.textContent = "AWAITING TEST";
  dom.decayReadout.textContent = "ΔE 0%";
}

function replaceChain(root) {
  chain = buildChain(state.shape, root ?? chain.positions[0]);
  renderer.chain = chain;
  resetTelemetry();
  updateShapeReadouts();
}

function beginResume() {
  const from = state.hold?.position ?? chain.positions[0];
  state.resume = { from: [...from], elapsed: 0, duration: 0.52 };
  state.hold = null;
}

function finalizeStopExperiment() {
  if (state.experiment.kind !== "stop" || state.experiment.result != null) return;
  const start = Math.max(state.experiment.startEnergy, 0.06);
  const settled = chain.energy;
  const decay = clamp((1 - settled / start) * 100, 0, 100);
  state.experiment.result = decay;
  state.experiment.settledEnergy = settled;
  state.experiment.kind = "settled";
  dom.stopTestBtn.classList.remove("is-running");
  document.getElementById("quickStopBtn").classList.remove("is-running");
  dom.scopeState.textContent = "SUDDEN STOP / SETTLED";
}

function updateSimulation(step) {
  state.simTime += step;
  state.phase += step * state.speed;

  const desired = trajectoryPoint(state.trajectory, state.phase);
  let rootPosition = desired;
  if (state.hold) {
    state.hold.elapsed += step;
    rootPosition = state.hold.position;
    if (state.hold.kind === "stop" && state.hold.elapsed >= 3.15) {
      finalizeStopExperiment();
    }
    if (state.hold.elapsed >= state.hold.duration) beginResume();
  } else if (state.resume) {
    state.resume.elapsed += step;
    const progress = smoothstep(state.resume.elapsed / state.resume.duration);
    rootPosition = [
      lerp(state.resume.from[0], desired[0], progress),
      lerp(state.resume.from[1], desired[1], progress),
      lerp(state.resume.from[2], desired[2], progress),
    ];
    if (progress >= 1) state.resume = null;
  }

  chain.options.linearDamping = state.damping;
  chain.step(
    step,
    { position: rootPosition },
    {
      iterations: state.iterations,
      maxBend: state.bendDeg * DEG,
      teleportPolicy: state.teleportPolicy,
    },
  );

  if (state.simTime * state.hz % 3 < 1) {
    state.rootTrail.push([...chain.positions[0]]);
    if (state.rootTrail.length > 130) state.rootTrail.shift();
  }

  state.historyTimer += step;
  if (state.historyTimer >= 0.055) {
    state.historyTimer = 0;
    state.energyHistory.push(chain.energy);
    if (state.energyHistory.length > 160) state.energyHistory.shift();
    state.lastEnergySample = chain.energy;
  }
}

function updateTelemetry() {
  const contacts = chain.collisions;
  dom.lengthErrorReadout.textContent = formatNumber(chain.lengthError, 4);
  dom.lengthErrorPercent.textContent = `${(chain.lengthErrorRatio * 100).toFixed(2)}%`;
  dom.collisionReadout.textContent = contacts.length;
  dom.speedReadout.textContent = formatNumber(chain.maxSpeed, 2);
  dom.tipSpeedReadout.textContent = `tip ${formatNumber(chain.endSpeed, 2)}`;
  dom.energyReadout.textContent = formatNumber(chain.energy, 2);
  dom.contactBadge.querySelector("b").textContent = contacts.length;
  dom.contactBadge.classList.toggle("has-contact", contacts.length > 0);
  dom.collisionReadout.closest(".metric").classList.toggle("has-contact", contacts.length > 0);

  if (contacts.length > 0) {
    const segments = contacts.map((contact) => `S${contact.index}`).join(" · ");
    const impact = Math.max(...contacts.map((contact) => contact.normalSpeed));
    dom.collisionDetail.textContent = impact > 0.02 ? `${segments} / ${impact.toFixed(2)} u/s` : segments;
    const projected = renderer.project(contacts[0].point);
    if (projected && projected.x > 20 && projected.x < renderer.width - 20) {
      dom.contactCallout.hidden = false;
      dom.contactCallout.style.left = `${clamp(projected.x, 15, renderer.width - 138)}px`;
      dom.contactCallout.style.top = `${clamp(projected.y, 55, renderer.height - 85)}px`;
      dom.contactLabel.textContent = `S${contacts[0].index}`;
    } else {
      dom.contactCallout.hidden = true;
    }
  } else {
    dom.contactCallout.hidden = true;
    dom.collisionDetail.textContent = "clear";
  }

  const energyDelta = chain.energy - state.lastEnergySample;
  dom.energyTrend.textContent =
    Math.abs(energyDelta) < 0.015 ? "stable" : energyDelta < 0 ? `↓ ${Math.abs(energyDelta).toFixed(2)}` : `↑ ${energyDelta.toFixed(2)}`;

  const relaxed = chain.lengthErrorRatio > 0.025 || chain.maxSpeed > 15;
  dom.solverState.innerHTML = relaxed
    ? "<i></i>RELAXED"
    : "<i></i>STABLE";
  dom.solverState.style.color = relaxed ? "var(--orange)" : "";

  const minimum = state.energyHistory.length ? Math.min(...state.energyHistory) : 0;
  const maximum = state.energyHistory.length ? Math.max(...state.energyHistory) : 0;
  dom.scopeRange.textContent = `${minimum.toFixed(2)} — ${maximum.toFixed(2)}`;

  if (state.experiment.kind === "stop" && state.experiment.startEnergy > 0) {
    const decay = clamp((1 - chain.energy / state.experiment.startEnergy) * 100, 0, 100);
    dom.decayReadout.textContent = `ΔE −${decay.toFixed(0)}%`;
    dom.scopeState.textContent = "HOLD / SETTLING";
  } else if (state.experiment.kind === "settled") {
    dom.decayReadout.textContent = `ΔE −${state.experiment.result.toFixed(0)}%`;
    dom.scopeState.textContent = "SUDDEN STOP / SETTLED";
  } else if (state.experiment.kind === "rotate") {
    const elapsed = state.simTime - state.experiment.startedAt;
    dom.decayReadout.textContent = elapsed > 3 ? "BOUNDED" : "SPINNING UP";
    dom.scopeState.textContent = elapsed > 3 ? "CONTINUOUS / STEADY" : "CONTINUOUS ROTATION";
  }

  dom.teleportBadge.textContent = state.teleportPolicy === "reset" ? "RESET" : "MOMENTUM";
  dom.driverStatus.textContent = `ROOT PATH · ${TRAJECTORY_LABELS[state.trajectory]}`;
  dom.runState.textContent = state.paused
    ? "PAUSED"
    : state.hold?.kind === "stop"
      ? "SETTLING"
      : state.hold
        ? "TELEPORT"
        : "LIVE";
}

function buildPathPreview() {
  const preview = [];
  for (let index = 0; index < 42; index += 1) {
    preview.push(trajectoryPoint(state.trajectory, state.phase + index * 0.075 * state.speed));
  }
  return preview;
}

function renderLoop(now) {
  const elapsed = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  fpsFrames += 1;
  if (now - fpsTime >= 500) {
    dom.fpsReadout.textContent = Math.round((fpsFrames * 1000) / (now - fpsTime));
    fpsFrames = 0;
    fpsTime = now;
  }

  if (!state.paused) {
    state.accumulator += elapsed;
    const step = 1 / state.hz;
    let iterations = 0;
    while (state.accumulator >= step && iterations < 8) {
      updateSimulation(step);
      state.accumulator -= step;
      iterations += 1;
    }
  } else {
    state.accumulator = 0;
  }

  state.telemetryTimer += elapsed;
  if (state.telemetryTimer >= 0.08) {
    state.telemetryTimer = 0;
    updateTelemetry();
  }

  renderer.render({
    time: state.simTime,
    shape: state.shape,
    overlays: state.overlays,
    rootTrail: state.rootTrail,
    pathPreview: buildPathPreview(),
  });
  drawEnergyScope(dom.energyCanvas, state.energyHistory, {
    markerIndex: state.experiment.markerIndex,
    stopped: state.experiment.kind === "stop" || state.experiment.kind === "settled",
  });
  requestAnimationFrame(renderLoop);
}

function setOverlay(name, enabled) {
  state.overlays[name] = enabled;
  const checkbox = document.querySelector(`input[data-overlay="${name}"]`);
  if (checkbox) checkbox.checked = enabled;
  if (name === "trail") {
    dom.trailToggle.classList.toggle("is-active", enabled);
    dom.trailToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
  }
}

function startStopExperiment() {
  if (state.hold?.kind === "stop") {
    finalizeStopExperiment();
    beginResume();
    return;
  }
  if (state.paused) setPaused(false);
  state.resume = null;
  state.hold = {
    position: [...chain.positions[0]],
    elapsed: 0,
    duration: 4.35,
    kind: "stop",
  };
  state.experiment = {
    kind: "stop",
    startEnergy: Math.max(chain.energy, 0.04),
    markerIndex: Math.max(0, state.energyHistory.length - 1),
    result: null,
    startedAt: state.simTime,
  };
  dom.stopTestBtn.classList.add("is-running");
  document.getElementById("quickStopBtn").classList.add("is-running");
  document.getElementById("quickRotateBtn").classList.remove("is-running");
  dom.rotateTestBtn.classList.remove("is-running");
  dom.scopeState.textContent = "HOLD / SETTLING";
}

function startRotationExperiment() {
  const rootBefore = [...chain.positions[0]];
  if (state.paused) setPaused(false);
  state.hold = null;
  state.resume = { from: rootBefore, elapsed: 0, duration: 0.52 };
  state.trajectory = "orbit";
  state.speed = 1.75;
  state.experiment = {
    kind: "rotate",
    startEnergy: Math.max(chain.energy, 0.04),
    markerIndex: Math.max(0, state.energyHistory.length - 1),
    result: null,
    startedAt: state.simTime,
  };
  document.getElementById("speedRange").value = "1.75";
  dom.driverSpeedReadout.textContent = "1.75×";
  dom.trajectoryReadout.textContent = TRAJECTORY_LABELS.orbit;
  setActive(document.getElementById("trajectoryControl"), document.querySelector('[data-trajectory="orbit"]'));
  dom.stopTestBtn.classList.remove("is-running");
  document.getElementById("quickStopBtn").classList.remove("is-running");
  document.getElementById("quickRotateBtn").classList.add("is-running");
  dom.rotateTestBtn.classList.add("is-running");
  dom.scopeState.textContent = "CONTINUOUS ROTATION";
}

function manualTeleport() {
  const current = chain.positions[0];
  const destination = [-current[0] * 1.04, 1.62, -current[2] * 1.04];
  chain.teleportRoot(destination, state.teleportPolicy);
  state.resume = null;
  state.hold = {
    position: destination,
    elapsed: 0,
    duration: 1.05,
    kind: "manual",
  };
  state.rootTrail.push([...destination]);
}

function setPaused(paused) {
  state.paused = paused;
  state.accumulator = 0;
  dom.pauseLabel.textContent = paused ? "继续" : "暂停";
  dom.pauseIconPath.setAttribute("d", paused ? "M7 4l9 6-9 6z" : "M6 4v12M14 4v12");
  dom.runState.textContent = paused ? "PAUSED" : "LIVE";
}

function bindControls() {
  const shapeControl = document.getElementById("shapeControl");
  shapeControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-shape]");
    if (!button) return;
    state.shape = button.dataset.shape;
    setActive(shapeControl, button);
    replaceChain([...chain.positions[0]]);
  });

  const iterationControl = document.getElementById("iterationControl");
  iterationControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-iterations]");
    if (!button) return;
    state.iterations = Number(button.dataset.iterations);
    setActive(iterationControl, button);
    dom.iterationReadout.textContent = `${state.iterations} × PASS`;
    dom.solverBadge.textContent = `PBD × ${state.iterations}`;
  });

  const timestepControl = document.getElementById("timestepControl");
  timestepControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-hz]");
    if (!button) return;
    state.hz = Number(button.dataset.hz);
    state.accumulator = 0;
    setActive(timestepControl, button);
    dom.stepReadout.textContent = `1 / ${state.hz} s`;
    dom.stepBadge.textContent = `${state.hz} HZ`;
  });

  const bendRange = document.getElementById("bendRange");
  bendRange.addEventListener("input", () => {
    state.bendDeg = Number(bendRange.value);
    dom.bendReadout.textContent = `${state.bendDeg}°`;
  });

  const dampingRange = document.getElementById("dampingRange");
  dampingRange.addEventListener("input", () => {
    state.damping = Number(dampingRange.value);
    dom.dampingReadout.textContent = `${state.damping.toFixed(2)} s⁻¹`;
  });

  const trajectoryControl = document.getElementById("trajectoryControl");
  trajectoryControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-trajectory]");
    if (!button) return;
    state.trajectory = button.dataset.trajectory;
    if (state.experiment.kind === "rotate" && state.trajectory !== "orbit") {
      state.experiment.kind = null;
      dom.rotateTestBtn.classList.remove("is-running");
      document.getElementById("quickRotateBtn").classList.remove("is-running");
      dom.scopeState.textContent = "AWAITING TEST";
    }
    setActive(trajectoryControl, button);
    dom.trajectoryReadout.textContent = TRAJECTORY_LABELS[state.trajectory];
    if (!state.hold) {
      state.resume = { from: [...chain.positions[0]], elapsed: 0, duration: 0.42 };
    }
  });

  const speedRange = document.getElementById("speedRange");
  speedRange.addEventListener("input", () => {
    state.speed = Number(speedRange.value);
    dom.driverSpeedReadout.textContent = `${state.speed.toFixed(2)}×`;
  });

  const policyControl = document.getElementById("teleportPolicyControl");
  policyControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-policy]");
    if (!button) return;
    state.teleportPolicy = button.dataset.policy;
    setActive(policyControl, button);
    dom.policyNote.textContent =
      state.teleportPolicy === "reset"
        ? "位移超过 0.58 u 视为瞬移：链条回到新根下的静止垂链。"
        : "位移超过 0.58 u 视为瞬移：整条链平移并保留原世界速度，随后继续约束求解。";
  });

  document.getElementById("teleportBtn").addEventListener("click", manualTeleport);
  document.getElementById("pauseBtn").addEventListener("click", () => setPaused(!state.paused));
  document.getElementById("resetViewBtn").addEventListener("click", () => renderer.resetCamera());
  dom.stopTestBtn.addEventListener("click", startStopExperiment);
  dom.rotateTestBtn.addEventListener("click", startRotationExperiment);
  document.getElementById("quickStopBtn").addEventListener("click", startStopExperiment);
  document.getElementById("quickRotateBtn").addEventListener("click", startRotationExperiment);

  dom.trailToggle.addEventListener("click", () => setOverlay("trail", !state.overlays.trail));
  for (const checkbox of document.querySelectorAll("input[data-overlay]")) {
    checkbox.addEventListener("change", () => setOverlay(checkbox.dataset.overlay, checkbox.checked));
  }

  dom.sceneCanvas.addEventListener("pointerdown", () => dom.dragHint.classList.add("is-hidden"));
  window.addEventListener("keydown", (event) => {
    if (event.target.matches("input, button")) return;
    if (event.code === "Space") {
      event.preventDefault();
      setPaused(!state.paused);
    }
    if (event.key.toLowerCase() === "r") renderer.resetCamera();
  });
}

let lastFrame = performance.now();
let fpsFrames = 0;
let fpsTime = lastFrame;

updateShapeReadouts();
bindControls();
updateTelemetry();
requestAnimationFrame(renderLoop);
