import { makeSphere, makeOpenSheet, meshStats, vertexAt, faceVertices } from "./geometry.js";
import { windingNumber, classifyQuery } from "./winding.js";
import { MeshRenderer } from "./renderer.js";
import { SliceView, AXIS_INFO } from "./slice-view.js";
import { runBuiltInBenchmarks } from "./benchmark.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const state = {
  scene: "sphere",
  mesh: null,
  query: [0, 0, 0],
  result: null,
  classification: null,
  epsilon: 0.008,
  band: 0.035,
  cutMode: false,
  history: [],
  sliceAxis: 1,
  sliceValue: 0,
  showSliceValues: true,
  audit: null,
};

const SCENES = {
  sphere: {
    title: "Closed sphere",
    factory: () => makeSphere({ rings: 14, segments: 28 }),
    initialQuery: [0, 0, 0],
    sliceAxis: 1,
  },
  flipped: {
    title: "Inverted sphere",
    factory: () => makeSphere({ rings: 14, segments: 28, flipped: true }),
    initialQuery: [0, 0, 0],
    sliceAxis: 1,
  },
  sheet: {
    title: "Open sheet",
    factory: () => makeOpenSheet({ size: 2.4, segments: 18 }),
    initialQuery: [0, 0.32, 0],
    sliceAxis: 0,
  },
};

let renderer;
let sliceView;
let sliceTimer = 0;

function formatSigned(value, digits = 6) {
  const normalized = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return normalized.toFixed(digits);
}

function activeRemovedCount(mesh) {
  let count = 0;
  for (const removed of mesh.removed) count += removed;
  return count;
}

function loadScene(name) {
  const definition = SCENES[name];
  state.scene = name;
  state.mesh = definition.factory();
  state.history = [];
  state.query = definition.initialQuery.slice();
  state.sliceAxis = definition.sliceAxis;
  renderer.setMesh(state.mesh);
  setCutMode(false);

  const bounds = meshStats(state.mesh).bounds;
  state.sliceValue = bounds.center[state.sliceAxis];
  sliceView.setMesh(state.mesh);
  configureSliceForAxis(state.sliceAxis, state.sliceValue);

  syncQueryInputs();
  evaluateQuery();
  updateSceneUI();
  updateTelemetry();
  updateCutControls();
  updateSliceLabels();
  updateSlicePlane();
  scheduleSlice(0);

  $$(".scene-button").forEach((button) => {
    const active = button.dataset.scene === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function evaluateQuery() {
  if (!state.mesh) return;
  const result = windingNumber(state.mesh, state.query);
  const classification = classifyQuery(result, {
    surfaceEpsilon: state.epsilon,
    valueBand: state.band,
  });
  classification.winding = result.winding;
  classification.solidAngle = result.solidAngle;
  classification.nearestDistance = result.nearestDistance;
  classification.nearestPoint = result.nearestPoint;
  classification.nearestFace = result.nearestFace;
  state.result = result;
  state.classification = classification;
  renderer.setQuery(state.query, classification);
  sliceView.setQuery(state.query);
  sliceView.draw();
  updateResultCard();
}

function updateResultCard() {
  const classification = state.classification;
  const result = state.result;
  if (!classification || !result) return;
  const card = $("#result-card");
  card.classList.remove("is-inside", "is-outside", "is-uncertain", "is-surface");
  card.classList.add(`is-${classification.kind}`);
  $("#result-status").textContent = classification.label;
  $("#winding-value").textContent = formatSigned(result.winding);
  $("#solid-angle").textContent = Number.isFinite(result.solidAngle)
    ? `${result.solidAngle.toFixed(6)} sr`
    : "—";
  $("#nearest-distance").textContent = Number.isFinite(result.nearestDistance)
    ? `${result.nearestDistance.toFixed(5)} u`
    : "no active face";
  $("#face-ratio").textContent = `${state.mesh.removed.length - activeRemovedCount(state.mesh)} / ${state.mesh.removed.length}`;
  $("#result-note").textContent = classification.detail;
}

function updateSceneUI() {
  const stats = meshStats(state.mesh);
  const open = stats.openEdges > 0;
  $("#scene-title").textContent = SCENES[state.scene].title;
  $("#scene-orientation").textContent = open
    ? "OPEN / TWO-SIDED"
    : stats.volume < 0 ? "INWARD" : "OUTWARD";
  $("#scene-topology").textContent = open ? `OPEN · ${stats.openEdges} EDGES` : "WATERTIGHT";
}

function updateTelemetry() {
  const stats = meshStats(state.mesh);
  const removed = activeRemovedCount(state.mesh);
  $("#header-faces").textContent = `${stats.faces} ACTIVE FACES`;
  $("#stat-faces").textContent = `${stats.faces} / ${stats.totalFaces}`;
  $("#stat-boundary").textContent = stats.openEdges ? `${stats.openEdges} edges` : "closed";
  $("#stat-volume").textContent = stats.openEdges ? "—" : formatSigned(stats.volume, 3);
  $("#stat-area").textContent = stats.area.toFixed(3);
  $("#removed-count").textContent = removed;
  $("#cut-hint").textContent = stats.openEdges
    ? `${stats.openEdges} boundary edges`
    : "mesh watertight";
  updateSceneUI();
}

function syncQueryInputs() {
  $("#query-x").value = state.query[0].toFixed(3);
  $("#query-y").value = state.query[1].toFixed(3);
  $("#query-z").value = state.query[2].toFixed(3);
}

function readQueryInputs() {
  const raw = ["#query-x", "#query-y", "#query-z"].map((selector) => $(selector).value);
  if (raw.some((value) => value.trim() === "")) return;
  const values = raw.map(Number);
  if (values.every(Number.isFinite)) {
    state.query = values;
    evaluateQuery();
  }
}

function setQuery(point, syncInputs = true) {
  state.query = point.map((value) => Number(value.toFixed(6)));
  if (syncInputs) syncQueryInputs();
  evaluateQuery();
}

function setCutMode(enabled) {
  state.cutMode = enabled;
  renderer.setCutMode(enabled);
  const toggle = $("#cut-toggle");
  toggle.setAttribute("aria-pressed", String(enabled));
  $("#cut-badge").classList.toggle("is-visible", enabled);
  if (!enabled) hideFaceTooltip();
}

function afterMeshEdit() {
  updateTelemetry();
  updateCutControls();
  evaluateQuery();
  updateSceneUI();
  scheduleSlice(20);
  updateSliceLabels();
}

function toggleFace(face) {
  const previous = state.mesh.removed[face];
  state.mesh.removed[face] = previous ? 0 : 1;
  state.history.push({ faces: [face], previous: [previous] });
  afterMeshEdit();
}

function updateCutControls() {
  $("#undo-cut").disabled = state.history.length === 0;
  $("#restore-all").disabled = activeRemovedCount(state.mesh) === 0;
}

function removeRandomFaces(fraction = 0.1) {
  const active = [];
  for (let face = 0; face < state.mesh.removed.length; face += 1) {
    if (!state.mesh.removed[face]) active.push(face);
  }
  if (active.length === 0) return;
  for (let index = active.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [active[index], active[swap]] = [active[swap], active[index]];
  }
  const faces = active.slice(0, Math.max(1, Math.round(state.mesh.removed.length * fraction)));
  const previous = faces.map((face) => state.mesh.removed[face]);
  faces.forEach((face) => { state.mesh.removed[face] = 1; });
  state.history.push({ faces, previous });
  afterMeshEdit();
}

function undoCut() {
  const action = state.history.pop();
  if (!action) return;
  action.faces.forEach((face, index) => {
    state.mesh.removed[face] = action.previous[index];
  });
  afterMeshEdit();
}

function restoreAllFaces() {
  const previous = Array.from(state.mesh.removed);
  const changed = [];
  previous.forEach((removed, face) => {
    if (removed) changed.push(face);
  });
  if (changed.length === 0) return;
  state.mesh.removed.fill(0);
  state.history.push({
    faces: changed,
    previous: changed.map((face) => previous[face]),
  });
  afterMeshEdit();
}

function configureSliceForAxis(axis, value) {
  state.sliceAxis = axis;
  const bounds = meshStats(state.mesh).bounds;
  const range = bounds.max[axis] - bounds.min[axis];
  const margin = Math.max(0.08, range * 0.12);
  const minimum = bounds.min[axis] - margin;
  const maximum = bounds.max[axis] + margin;
  state.sliceValue = Math.max(minimum, Math.min(maximum, value ?? bounds.center[axis]));
  const slider = $("#slice-range");
  slider.min = minimum.toFixed(3);
  slider.max = maximum.toFixed(3);
  slider.step = Math.max(0.005, (maximum - minimum) / 180).toFixed(4);
  slider.value = state.sliceValue;
  sliceView.setAxis(axis, state.sliceValue);
  sliceView.setValue(state.sliceValue);
  sliceView.setSettings({
    epsilon: state.epsilon,
    band: state.band,
    showValues: state.showSliceValues,
  });
  $$(".axis-tabs button").forEach((button) => {
    const active = Number(button.dataset.axis) === axis;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updateSliceLabels();
  updateSlicePlane();
}

function updateSliceLabels() {
  const info = AXIS_INFO[state.sliceAxis];
  $("#slice-axis-label").textContent = `${info.label} slice`;
  $("#slice-output").textContent = state.sliceValue.toFixed(3);
  $("#slice-caption-h").textContent = info.uLabel;
  $("#slice-caption-v").textContent = info.vLabel;
}

function updateSlicePlane() {
  renderer.setSlicePlane({
    axis: state.sliceAxis,
    value: state.sliceValue,
  });
}

function setSliceValue(value) {
  state.sliceValue = value;
  sliceView.setValue(value);
  updateSlicePlane();
  updateSliceLabels();
  scheduleSlice(45);
}

function scheduleSlice(delay = 55) {
  window.clearTimeout(sliceTimer);
  sliceTimer = window.setTimeout(() => {
    sliceView.compute();
    sliceView.draw();
  }, delay);
}

function shortClassification(label) {
  if (label.startsWith("INSIDE")) return "inside";
  if (label.startsWith("OUTSIDE")) return "outside";
  if (label.startsWith("SURFACE")) return "surface";
  return "uncertain";
}

function showSliceSample(sample) {
  const info = AXIS_INFO[state.sliceAxis];
  const u = sample.point[info.uAxis];
  const v = sample.point[info.vAxis];
  $("#slice-coords").textContent = `${info.uLabel.toLowerCase()} ${u.toFixed(2)} · ${info.vLabel.toLowerCase()} ${v.toFixed(2)}`;
  $("#slice-winding").textContent = `W ${formatSigned(sample.result.winding, 4)} · ${shortClassification(sample.classification.label)}`;
  $("#slice-hover-plane").style.left = `${sample.nx * 100}%`;
  $("#slice-hover-plane").style.opacity = "1";
}

function clearSliceSample() {
  const info = AXIS_INFO[state.sliceAxis];
  $("#slice-coords").textContent = `${info.uLabel.toLowerCase()} / ${info.vLabel.toLowerCase()} plane · hover to inspect`;
  $("#slice-winding").textContent = "W —";
  $("#slice-hover-plane").style.opacity = "0";
}

function pickSliceSample(sample) {
  setQuery(sample.point);
}

function showFaceTooltip(face, pointer) {
  const tooltip = $("#scene-tooltip");
  if (!state.cutMode || face < 0 || !pointer.inside) {
    hideFaceTooltip();
    return;
  }
  const removed = state.mesh.removed[face];
  tooltip.textContent = `face ${face} · ${removed ? "click to restore" : "click to remove"}`;
  tooltip.style.left = `${Math.min(pointer.x, renderer.width - 170)}px`;
  tooltip.style.top = `${pointer.y}px`;
  tooltip.classList.add("is-visible");
}

function hideFaceTooltip() {
  $("#scene-tooltip").classList.remove("is-visible");
}

function setQuickProbe(name) {
  if (name === "edge") {
    let face = 0;
    while (face < state.mesh.removed.length && state.mesh.removed[face]) face += 1;
    if (face >= state.mesh.removed.length) return;
    const [a, b] = faceVertices(state.mesh, face);
    setQuery([
      (a[0] + b[0]) * 0.5,
      (a[1] + b[1]) * 0.5,
      (a[2] + b[2]) * 0.5,
    ]);
    return;
  }
  if (name === "vertex") {
    if (state.scene === "sheet") {
      const point = [0, 0, 0];
      setQuery(vertexAt(state.mesh, 0, point));
    } else {
      setQuery([0, 1, 0]);
    }
    return;
  }
  if (name === "outside") {
    if (state.scene === "sheet") setQuery([2.1, 1.4, 1.6]);
    else setQuery([1.45, 0.75, 0.55]);
    return;
  }
  if (state.scene === "sheet") setQuery([0, 0.32, 0]);
  else setQuery([0, 0, 0]);
}

function auditRow(title, status, detail, warn = false) {
  return `<div class="audit-row${warn ? " is-warn" : ""}">
    <strong>${title}</strong>
    <span class="audit-pass">${status}</span>
    <p>${detail}</p>
  </div>`;
}

function renderAudit(audit) {
  const closedPass = audit.closed.tested > 0
    && audit.closed.containmentAgreement >= 0.999
    && audit.closed.maxWindingError < 0.005;
  const flippedPass = audit.flipped.tested > 0
    && audit.flipped.containmentAgreement >= 0.999
    && audit.flipped.signedAgreement >= 0.999
    && audit.flipped.maxWindingError < 0.005;
  const sheetPass = audit.sheet.tested > 0
    && audit.sheet.fractional === audit.sheet.tested
    && audit.sheet.signPairs === audit.sheet.tested
    && audit.sheet.maxMagnitude <= 1;
  const passes = Number(closedPass) + Number(flippedPass) + Number(sheetPass);

  const rows = [
    auditRow(
      "Closed sphere",
      closedPass ? "PASS" : "REVIEW",
      `${Math.round(audit.closed.containmentAgreement * audit.closed.tested)}/${audit.closed.tested} containment matches · mean |ΔW| ${audit.closed.meanWindingError.toExponential(1)} · max ${audit.closed.maxWindingError.toExponential(1)}`,
    ),
    auditRow(
      "Flipped sphere",
      flippedPass ? "PASS" : "REVIEW",
      `${Math.round(audit.flipped.containmentAgreement * audit.flipped.tested)}/${audit.flipped.tested} |W| matches · signed W orientation ${Math.round(audit.flipped.signedAgreement * audit.flipped.tested)}/${audit.flipped.tested} · max |ΔW| ${audit.flipped.maxWindingError.toExponential(1)}`,
    ),
    auditRow(
      "Open sheet",
      sheetPass ? "FRACTIONAL" : "REVIEW",
      `${audit.sheet.fractional}/${audit.sheet.tested} fractional · ${audit.sheet.signPairs}/${audit.sheet.tested} side sign flips · max |W| ${audit.sheet.maxMagnitude.toFixed(3)} · analytic ball n/a`,
      !sheetPass,
    ),
  ];
  $("#audit-list").innerHTML = rows.join("");
  $("#audit-score").textContent = `${passes} / 3`;
  $("#audit-score").style.color = passes === 3 ? "var(--green)" : "var(--pink)";
  $("#audit-note").textContent = sheetPass
    ? "Closed and inverted meshes match |p| < R exactly. The open sheet stays fractional and changes sign across its two sides; no analytic ball containment applies."
    : "At least one check needs review. Try reducing ε or δ, or restoring removed faces.";
}

function runAudit() {
  const button = $("#audit-button");
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Auditing…";
  $("#audit-list").classList.add("is-loading");
  window.setTimeout(() => {
    state.audit = runBuiltInBenchmarks({
      surfaceEpsilon: state.epsilon,
      valueBand: state.band,
    });
    renderAudit(state.audit);
    $("#audit-list").classList.remove("is-loading");
    button.disabled = false;
    button.textContent = "Run audit";
  }, 60);
}

function bindControls() {
  $$(".scene-button").forEach((button) => {
    button.addEventListener("click", () => loadScene(button.dataset.scene));
  });

  $("#frame-button").addEventListener("click", () => renderer.frameMesh());
  $("#audit-button").addEventListener("click", runAudit);
  $("#cut-toggle").addEventListener("click", () => setCutMode(!state.cutMode));
  $("#remove-random").addEventListener("click", () => removeRandomFaces(0.1));
  $("#undo-cut").addEventListener("click", undoCut);
  $("#restore-all").addEventListener("click", restoreAllFaces);

  ["#query-x", "#query-y", "#query-z"].forEach((selector) => {
    $(selector).addEventListener("input", readQueryInputs);
  });
  $$(".quick-probes button").forEach((button) => {
    button.addEventListener("click", () => setQuickProbe(button.dataset.probe));
  });

  $("#epsilon-range").addEventListener("input", (event) => {
    state.epsilon = Number(event.target.value);
    $("#epsilon-output").textContent = state.epsilon.toFixed(3);
    sliceView.setSettings({ epsilon: state.epsilon });
    evaluateQuery();
    scheduleSlice(45);
  });
  $("#band-range").addEventListener("input", (event) => {
    state.band = Number(event.target.value);
    $("#band-output").textContent = state.band.toFixed(3);
    sliceView.setSettings({ band: state.band });
    evaluateQuery();
    scheduleSlice(45);
  });

  $$(".axis-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      const axis = Number(button.dataset.axis);
      if (axis === state.sliceAxis) return;
      const bounds = meshStats(state.mesh).bounds;
      configureSliceForAxis(axis, bounds.center[axis]);
      scheduleSlice(20);
      clearSliceSample();
    });
  });
  $("#slice-range").addEventListener("input", (event) => {
    setSliceValue(Number(event.target.value));
  });
  $("#values-toggle").addEventListener("click", () => {
    state.showSliceValues = !state.showSliceValues;
    const button = $("#values-toggle");
    button.classList.toggle("is-active", state.showSliceValues);
    button.setAttribute("aria-pressed", String(state.showSliceValues));
    sliceView.setSettings({ showValues: state.showSliceValues });
    sliceView.draw();
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key.toLowerCase() === "c") setCutMode(!state.cutMode);
    if (event.key.toLowerCase() === "r") renderer.frameMesh();
    if (event.key === "Escape") setCutMode(false);
  });
}

function boot() {
  renderer = new MeshRenderer($("#scene-canvas"), {
    onFaceClick: toggleFace,
    onHover: showFaceTooltip,
  });
  sliceView = new SliceView($("#slice-canvas"), {
    onSample: showSliceSample,
    onLeave: clearSliceSample,
    onPick: pickSliceSample,
  });
  sliceView.setSettings({
    epsilon: state.epsilon,
    band: state.band,
    showValues: state.showSliceValues,
  });
  bindControls();
  loadScene("sphere");
  clearSliceSample();
  window.setTimeout(runAudit, 550);
}

boot();
