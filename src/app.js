import {
  add,
  analyzeTopology,
  boundingDiagonal,
  cloneVertices,
  length,
  scale,
  signedVolume,
  sub,
  topologyIssues
} from "./geometry.js";
import {
  makeDentedBox,
  makeFlippedBox,
  makeOpenBox,
  makeTetrahedron
} from "./meshes.js";
import { MeshRenderer } from "./renderer.js";
import { deformVolumePreserving } from "./solver.js";

const $ = (id) => document.getElementById(id);
const canvas = $("viewport");
const renderer = new MeshRenderer(canvas);

const fixtures = [makeDentedBox(), makeTetrahedron(), makeOpenBox(), makeFlippedBox()];
let controlSequence = 0;

const state = {
  mesh: fixtures[0],
  positions: cloneVertices(fixtures[0].vertices),
  controls: [],
  radius: 0.58,
  selectedVertex: null,
  diagnostics: null,
  lastFeasible: null,
  dragging: null,
  invalidFaces: new Set()
};

const cloneControls = (controls) =>
  controls.map((control) => ({
    ...control,
    target: control.target.slice()
  }));

const formatVolume = (value) =>
  Number.isFinite(value) ? value.toFixed(9) : "—";

const formatScientific = (value) =>
  Number.isFinite(value) ? value.toExponential(3) : "—";

const formatCoordinates = (point) =>
  `(${point.map((value) => value.toFixed(3)).join(", ")})`;

function meshHasValidTopology(mesh) {
  return topologyIssues(mesh).length === 0;
}

function maxControlError() {
  let maximum = 0;
  for (const control of state.controls) {
    maximum = Math.max(maximum, length(sub(state.positions[control.vertex], control.target)));
  }
  return maximum;
}

function collectInvalidFaces(mesh, diagnostics) {
  const invalid = new Set();
  const topology = analyzeTopology(mesh);
  for (const edge of [
    ...topology.boundaryEdges,
    ...topology.nonManifoldEdges,
    ...topology.inconsistentEdges
  ]) {
    for (const face of edge.faces) invalid.add(face);
  }
  for (const face of topology.degenerateFaces) invalid.add(face.face);

  const sources = [diagnostics?.flippedFaces, diagnostics?.issues];
  for (const source of sources) {
    for (const item of source ?? []) {
      for (const face of item.details?.flipped ?? []) invalid.add(face.face);
    }
  }
  return invalid;
}

function controlsForRenderer() {
  return state.controls.map((control) => ({
    id: control.id,
    vertex: control.vertex,
    target: control.target
  }));
}

function renderScene() {
  state.invalidFaces = collectInvalidFaces(state.mesh, state.diagnostics);
  renderer.setScene({
    positions: state.positions,
    controls: controlsForRenderer(),
    invalidFaces: state.invalidFaces,
    selectedVertex: state.selectedVertex
  });
}

function populateShapes() {
  const select = $("shape-select");
  for (const mesh of fixtures) {
    const option = document.createElement("option");
    option.value = mesh.name;
    option.textContent = mesh.name;
    select.append(option);
  }
  select.value = state.mesh.name;
}

function renderPreflight() {
  const topology = analyzeTopology(state.mesh);
  const volume = meshHasValidTopology(state.mesh) ? signedVolume(state.mesh) : null;
  const rows = [
    {
      label: "封闭边界",
      ok: topology.boundaryEdges.length === 0,
      value:
        topology.boundaryEdges.length === 0
          ? "PASS"
          : `${topology.boundaryEdges.length} 条开放边`
    },
    {
      label: "边绕向",
      ok: topology.inconsistentEdges.length === 0,
      value:
        topology.inconsistentEdges.length === 0
          ? "CONSISTENT"
          : `${topology.inconsistentEdges.length} 处反向`
    },
    {
      label: "退化面",
      ok: topology.degenerateFaces.length === 0,
      value:
        topology.degenerateFaces.length === 0
          ? "0"
          : `${topology.degenerateFaces.length} 个`
    },
    {
      label: "有符号体积",
      ok: volume !== null && volume > 0,
      value: volume === null ? "不定义" : formatScientific(volume)
    }
  ];

  const list = $("preflight-list");
  list.replaceChildren();
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = `check-item${row.ok ? "" : " is-bad"}`;
    const icon = document.createElement("span");
    icon.className = "check-icon";
    icon.textContent = row.ok ? "✓" : "!";
    const label = document.createElement("span");
    label.textContent = row.label;
    const value = document.createElement("span");
    value.className = "check-value";
    value.textContent = row.value;
    item.append(icon, label, value);
    list.append(item);
  }
}

function renderControls() {
  const list = $("control-list");
  list.replaceChildren();
  if (state.controls.length === 0) {
    const empty = document.createElement("div");
    empty.className = "control-empty";
    empty.textContent = "拖动任意网格顶点，创建首个控制点。";
    list.append(empty);
    return;
  }

  state.controls.forEach((control, index) => {
    const base = state.mesh.vertices[control.vertex];
    const delta = sub(control.target, base);
    const row = document.createElement("div");
    row.className = "control-item";

    const badge = document.createElement("span");
    badge.className = "control-badge";
    badge.textContent = String(index + 1).padStart(2, "0");

    const coordinates = document.createElement("div");
    coordinates.className = "control-coordinates";
    const title = document.createElement("strong");
    title.textContent = `#${control.vertex}  ${formatCoordinates(control.target)}`;
    const displacement = document.createElement("span");
    displacement.textContent = `Δ ${formatCoordinates(delta)}`;
    coordinates.append(title, displacement);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "control-remove";
    remove.dataset.controlId = String(control.id);
    remove.title = "移除此控制点";
    remove.setAttribute("aria-label", "移除此控制点");
    remove.textContent = "×";

    row.append(badge, coordinates, remove);
    list.append(row);
  });
}

function emptyIterationMessage(diagnostics) {
  if (diagnostics.stage === "topology" || diagnostics.stage === "local-deformation") {
    return "预检失败，未进入体积迭代";
  }
  if (diagnostics.status === "conflict") return "控制点冲突，未进入体积迭代";
  if (diagnostics.status === "infeasible-controls") return "约束不可行，未执行有效迭代";
  if (diagnostics.ok && diagnostics.status === "already-satisfied") return "初始残差已满足容差";
  return "暂无迭代数据";
}

function renderIterations(diagnostics) {
  const body = $("iteration-body");
  body.replaceChildren();
  const iterations = diagnostics.iterations ?? [];
  if (iterations.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = emptyIterationMessage(diagnostics);
    row.append(cell);
    body.append(row);
    return;
  }

  for (const step of iterations) {
    const row = document.createElement("tr");
    const values = [
      String(step.iteration),
      formatScientific(step.residual),
      formatScientific(step.maxCorrection),
      step.alpha.toFixed(2)
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
}

function renderMetrics(diagnostics) {
  const valid = meshHasValidTopology(state.mesh);
  const restVolume = valid ? signedVolume(state.mesh) : null;
  const currentVolume = valid ? signedVolume(state.mesh, state.positions) : null;
  const residual =
    valid && restVolume !== null ? currentVolume - restVolume : null;
  const controlError = maxControlError();

  $("rest-volume").textContent = restVolume === null ? "不定义" : formatVolume(restVolume);
  $("current-volume").textContent =
    currentVolume === null ? "不定义" : formatVolume(currentVolume);
  $("volume-residual").textContent =
    residual === null ? "—" : formatScientific(residual);
  $("control-residual").textContent = formatScientific(controlError);

  $("volume-residual").className =
    residual !== null && Math.abs(residual) < 1e-8 ? "is-good" : "is-bad";
  $("control-residual").className = controlError < 1e-9 ? "is-good" : "is-bad";

  $("mesh-count").textContent =
    `${state.mesh.vertices.length} VERTICES · ${state.mesh.faces.length} FACES`;
  const kind = $("mesh-kind");
  kind.textContent = valid ? "封闭网格" : "拓扑无效";
  kind.classList.toggle("is-bad", !valid);
  $("shape-description").textContent = state.mesh.description;

  const summary = diagnostics.summary;
  if (summary) {
    $("solver-meta").textContent =
      `容差 ${formatScientific(summary.tolerance)} · 自由 ${summary.freeVertexCount} · 固定 ${summary.fixedVertexCount}`;
  } else {
    $("solver-meta").textContent = "容差 1e-8 · 求解前预检已启用";
  }
}

function statusPresentation(diagnostics) {
  if (diagnostics.ok) {
    return {
      pill: "is-ready",
      pillText: diagnostics.status === "already-satisfied" ? "体积已满足" : "体积已保持"
    };
  }
  if (diagnostics.stage === "topology" || diagnostics.stage === "local-deformation") {
    return { pill: "is-error", pillText: "已阻止求解" };
  }
  if (diagnostics.status === "not-converged") {
    return { pill: "is-working", pillText: "约束未收敛" };
  }
  return { pill: "is-error", pillText: "约束冲突" };
}

function renderDiagnostics(diagnostics) {
  const presentation = statusPresentation(diagnostics);
  const pill = $("status-pill");
  pill.className = `status-pill ${presentation.pill}`;
  $("status-text").textContent = presentation.pillText;

  const stateCard = $("constraint-state");
  const title = $("constraint-title");
  const copy = $("constraint-copy");
  stateCard.className = "constraint-state";

  if (diagnostics.ok) {
    stateCard.classList.add("is-good");
    title.textContent =
      diagnostics.status === "already-satisfied" ? "初始形状已满足" : "体积约束已收敛";
    const lastStep = diagnostics.iterations.at(-1);
    copy.textContent = lastStep
      ? `共 ${diagnostics.iterations.length} 轮；末轮残差 ${formatScientific(lastStep.residual)}，max ‖Δx‖ ${formatScientific(lastStep.maxCorrection)}。`
      : "初始带符号体积与目标值的差已在容差内，无需修正。";
  } else if (diagnostics.stage === "topology" || diagnostics.stage === "local-deformation") {
    stateCard.classList.add("is-bad");
    title.textContent = "求解前预检已阻止";
    copy.textContent =
      diagnostics.stage === "topology"
        ? "未执行任何体积迭代；当前仅展示待诊断网格。"
        : "未执行任何体积迭代，渲染保持最后一次可行形状。";
  } else if (diagnostics.status === "not-converged") {
    stateCard.classList.add("is-warn");
    title.textContent = "达到迭代上限";
    copy.textContent = "结果未提交，当前视图仍为最后可行形状。";
  } else {
    stateCard.classList.add("is-bad");
    title.textContent =
      diagnostics.status === "conflict" ? "控制点互相矛盾" : "控制目标不可行";
    copy.textContent = "求解器已拒绝覆盖当前形状，并保留上一次可行结果。";
  }

  const conflictCard = $("conflict-card");
  if (diagnostics.ok) {
    conflictCard.hidden = true;
  } else {
    conflictCard.hidden = false;
    $("conflict-title").textContent =
      diagnostics.stage === "topology"
        ? "拓扑预检"
        : diagnostics.stage === "local-deformation"
          ? "局部变形预检"
          : diagnostics.status === "conflict"
            ? "控制点冲突"
            : "约束不可行";
    $("conflict-message").textContent = diagnostics.message;
  }

  const alert = $("viewport-alert");
  alert.hidden = diagnostics.ok;
  if (!diagnostics.ok) {
    $("viewport-alert-title").textContent =
      diagnostics.stage === "topology" || diagnostics.stage === "local-deformation"
        ? "求解前已阻止"
        : "已保留最后可行形状";
    $("viewport-alert-copy").textContent = diagnostics.message;
  }

  $("restore-feasible").disabled = !state.lastFeasible || diagnostics.ok;
  const topologyValid = meshHasValidTopology(state.mesh);
  $("local-bump").disabled = !topologyValid;
  $("conflict-demo").disabled = !topologyValid;
}

function renderAll() {
  renderPreflight();
  renderControls();
  renderIterations(state.diagnostics);
  renderMetrics(state.diagnostics);
  renderDiagnostics(state.diagnostics);
  renderScene();
}

function solveAndRender() {
  const diagnostics = deformVolumePreserving(state.mesh, state.controls, {
    radius: state.radius,
    relativeTolerance: 1e-8,
    maxIterations: 30
  });
  state.diagnostics = diagnostics;

  if (diagnostics.ok) {
    state.positions = cloneVertices(diagnostics.positions);
    state.lastFeasible = {
      controls: cloneControls(state.controls),
      positions: cloneVertices(state.positions),
      diagnostics,
      selectedVertex: state.selectedVertex
    };
  } else if (state.lastFeasible) {
    state.positions = cloneVertices(state.lastFeasible.positions);
  } else {
    state.positions = cloneVertices(state.mesh.vertices);
  }

  renderAll();
}

function selectShape(name) {
  const mesh = fixtures.find((candidate) => candidate.name === name);
  if (!mesh) return;
  state.mesh = mesh;
  state.positions = cloneVertices(mesh.vertices);
  state.controls = [];
  state.selectedVertex = null;
  state.diagnostics = null;
  state.lastFeasible = null;
  state.dragging = null;
  state.radius = Math.max(0.12, Math.min(1.1, boundingDiagonal(mesh.vertices) * 0.34));
  $("shape-select").value = mesh.name;
  $("radius-range").value = String(state.radius);
  $("radius-value").textContent = state.radius.toFixed(2);
  renderer.setMesh(mesh, state.positions);
  solveAndRender();
}

function outwardDirection(vertexIndex) {
  if (state.mesh.dentVertex === vertexIndex) return [0, 0, 1];
  const center = state.mesh.vertices
    .reduce(
      (sum, vertex) => add(sum, vertex),
      [0, 0, 0]
    )
    .map((value) => value / state.mesh.vertices.length);
  const direction = sub(state.mesh.vertices[vertexIndex], center);
  const magnitude = length(direction);
  return magnitude > 1e-9 ? scale(direction, 1 / magnitude) : [0, 0, 1];
}

function applyLocalBump() {
  if (!meshHasValidTopology(state.mesh)) return;
  const vertex =
    state.mesh.dentVertex ??
    state.selectedVertex ??
    state.mesh.vertices.reduce(
      (best, point, index) =>
        point[2] > state.mesh.vertices[best][2] ? index : best,
      0
    );
  const base = state.mesh.vertices[vertex];
  const target = add(base, scale(outwardDirection(vertex), 0.28));
  state.controls = [{ id: ++controlSequence, vertex, target }];
  state.selectedVertex = vertex;
  solveAndRender();
}

function showConflictDemo() {
  if (!meshHasValidTopology(state.mesh)) return;
  const sourceControls = state.lastFeasible?.controls ?? state.controls;
  const vertex =
    state.selectedVertex ??
    state.mesh.dentVertex ??
    sourceControls[0]?.vertex ??
    0;
  const base = state.mesh.vertices[vertex];
  const direction = outwardDirection(vertex);
  const retained = cloneControls(sourceControls).filter(
    (control) => control.vertex !== vertex
  );
  state.controls = [
    ...retained,
    {
      id: ++controlSequence,
      vertex,
      target: add(base, scale(direction, 0.18))
    },
    {
      id: ++controlSequence,
      vertex,
      target: add(base, scale(direction, -0.18))
    }
  ];
  state.selectedVertex = vertex;
  solveAndRender();
}

function restoreFeasible() {
  if (!state.lastFeasible) return;
  state.controls = cloneControls(state.lastFeasible.controls);
  state.positions = cloneVertices(state.lastFeasible.positions);
  state.diagnostics = state.lastFeasible.diagnostics;
  state.selectedVertex = state.lastFeasible.selectedVertex;
  renderAll();
}

function localCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function onPointerDown(event) {
  if (event.button !== 0 || state.dragging) return;
  const point = localCanvasPoint(event);
  const topologyValid = meshHasValidTopology(state.mesh);
  const controlPick = topologyValid
    ? renderer.pickControl(point.x, point.y, 16)
    : null;

  if (controlPick) {
    const control = state.controls.find(
      (candidate) => candidate.id === controlPick.id
    );
    if (!control) return;
    state.selectedVertex = control.vertex;
    state.dragging = {
      kind: "vertex",
      pointerId: event.pointerId,
      controlId: control.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      startTarget: control.target.slice(),
      depth: controlPick.depth,
      moved: false
    };
    canvas.setPointerCapture(event.pointerId);
    renderAll();
    return;
  }

  const pick = topologyValid ? renderer.pickVertex(point.x, point.y, 16) : null;
  if (pick) {
    let control = state.controls.find((candidate) => candidate.vertex === pick.index);
    if (!control) {
      control = {
        id: ++controlSequence,
        vertex: pick.index,
        target: state.mesh.vertices[pick.index].slice()
      };
      state.controls.push(control);
    }
    state.selectedVertex = pick.index;
    state.dragging = {
      kind: "vertex",
      pointerId: event.pointerId,
      controlId: control.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      startTarget: control.target.slice(),
      depth: pick.depth,
      moved: false
    };
    canvas.setPointerCapture(event.pointerId);
    solveAndRender();
    return;
  }

  state.dragging = {
    kind: "orbit",
    pointerId: event.pointerId,
    lastClientX: event.clientX,
    lastClientY: event.clientY
  };
  canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!state.dragging || state.dragging.pointerId !== event.pointerId) return;
  if (state.dragging.kind === "orbit") {
    const deltaX = event.clientX - state.dragging.lastClientX;
    const deltaY = event.clientY - state.dragging.lastClientY;
    state.dragging.lastClientX = event.clientX;
    state.dragging.lastClientY = event.clientY;
    renderer.orbit(deltaX, deltaY);
    return;
  }

  const deltaX = event.clientX - state.dragging.startClientX;
  const deltaY = event.clientY - state.dragging.startClientY;
  if (Math.hypot(deltaX, deltaY) > 2) state.dragging.moved = true;
  const control = state.controls.find(
    (candidate) => candidate.id === state.dragging.controlId
  );
  if (!control) return;
  const worldDelta = renderer.screenDeltaToWorld(deltaX, deltaY, state.dragging.depth);
  control.target = add(state.dragging.startTarget, worldDelta);
  state.selectedVertex = control.vertex;
  solveAndRender();
}

function endPointer(event) {
  if (!state.dragging || state.dragging.pointerId !== event.pointerId) return;
  state.dragging = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  renderAll();
}

function bindEvents() {
  $("shape-select").addEventListener("change", (event) => selectShape(event.target.value));
  $("radius-range").addEventListener("input", (event) => {
    state.radius = Number(event.target.value);
    $("radius-value").textContent = state.radius.toFixed(2);
    if (meshHasValidTopology(state.mesh)) solveAndRender();
  });
  $("local-bump").addEventListener("click", applyLocalBump);
  $("conflict-demo").addEventListener("click", showConflictDemo);
  $("restore-feasible").addEventListener("click", restoreFeasible);
  $("reset-controls").addEventListener("click", () => {
    state.controls = [];
    state.selectedVertex = null;
    solveAndRender();
  });
  $("control-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-control-id]");
    if (!button) return;
    const id = Number(button.dataset.controlId);
    state.controls = state.controls.filter((control) => control.id !== id);
    solveAndRender();
  });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      renderer.zoom(event.deltaY);
    },
    { passive: false }
  );
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}

populateShapes();
bindEvents();
selectShape(state.mesh.name);
