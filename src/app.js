import {
  buildEdges,
  clonePositions,
  createPresets,
  meshBounds,
  meshToOBJ,
  nearestVertexTo,
  resetMesh,
} from "./mesh.js";
import {
  analyzeConstraints,
  arapIterations,
  computeRotations,
  evaluatePositions,
  solveLaplacian,
} from "./arap.js";

const $ = (id) => document.getElementById(id);
const canvas = $("meshCanvas");
const context = canvas.getContext("2d");
const chart = $("energyChart");
const chartContext = chart.getContext("2d");
const viewport = $("viewport");

const dom = {
  status: $("solverStatus"),
  statusText: $("solverStatusText"),
  presetList: $("presetList"),
  meshKind: $("meshKind"),
  meshTitle: $("meshTitle"),
  meshDescription: $("meshDescription"),
  componentReport: $("componentReport"),
  constraintWarning: $("constraintWarning"),
  iterationLabel: $("iterationLabel"),
  energy: $("metricEnergy"),
  residual: $("metricResidual"),
  drift: $("metricDrift"),
  stretch: $("metricStretch"),
  stopCard: $("stopCard"),
  stopReason: $("stopReason"),
  stopDetail: $("stopDetail"),
  compareArapEnergy: $("compareArapEnergy"),
  compareArapResidual: $("compareArapResidual"),
  compareLapEnergy: $("compareLapEnergy"),
  compareLapResidual: $("compareLapResidual"),
  maxIterations: $("maxIterations"),
  maxIterationsValue: $("maxIterationsValue"),
  energyTolerance: $("energyTolerance"),
  rigidTolerance: $("rigidTolerance"),
  showLaplacian: $("showLaplacian"),
  toolNote: $("toolNote"),
  hint: $("viewportHint"),
  toast: $("toast"),
};

const presets = new Map(createPresets().map((mesh) => [mesh.id, mesh]));
const view = {
  width: 1,
  height: 1,
  scale: 60,
  centerX: 0,
  centerY: 0,
  ready: false,
};

let mesh = presets.get("strip");
let target = { index: mesh.control, x: mesh.positions[mesh.control * 2], y: mesh.positions[mesh.control * 2 + 1] };
let tool = "drag";
let anchorPositions = new Map();
let history = [];
let baseline = null;
let lastRun = null;
let laplacianResult = null;
let currentReport = null;
let activeGenerator = null;
let animationTimer = null;
let dragging = false;
let dragPointerId = null;
let dragOffset = { x: 0, y: 0 };
let dragDistance = 0;
let dragStartPoint = { x: 0, y: 0 };
let toastTimer = null;

function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute < 0.001 || absolute >= 10000)) {
    return value.toExponential(digits - 1);
  }
  return value.toFixed(digits);
}

function formatResidual(value) {
  if (!Number.isFinite(value)) return "—";
  return value === 0 ? "0.00e+0" : value.toExponential(2);
}

function showToast(message) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("visible");
  toastTimer = setTimeout(() => dom.toast.classList.remove("visible"), 2600);
}

function setStatus(kind, text) {
  dom.status.className = `solver-status ${kind}`;
  dom.statusText.textContent = text;
}

function setTool(nextTool, notify = true) {
  tool = nextTool;
  document.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  dom.toolNote.textContent =
    tool === "drag"
      ? "拖动橙色菱形；松手后逐次执行局部旋转与全局位置求解。"
      : "点击顶点切换固定状态。固定点以精确坐标进入全局线性系统。";
  dom.hint.classList.toggle("hidden", tool === "pin");
  if (notify) {
    showToast(tool === "drag" ? "拖动模式：点击非固定顶点可切换控制点" : "固定模式：点击顶点添加或移除约束");
  }
}

function setPresetButton(id) {
  document.querySelectorAll(".preset-card").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === id);
  });
}

function cancelAnimation() {
  clearTimeout(animationTimer);
  animationTimer = null;
  activeGenerator = null;
}

function getBaseline() {
  const edges = buildEdges(mesh);
  const rotations = computeRotations(mesh, mesh.positions, edges);
  const metrics = evaluatePositions(mesh, mesh.positions, rotations, edges);
  return { ...metrics, iteration: 0, anchorDrift: 0, positions: clonePositions(mesh.positions) };
}

function syncTargetToControl() {
  target = {
    index: mesh.control,
    x: mesh.positions[mesh.control * 2],
    y: mesh.positions[mesh.control * 2 + 1],
  };
}

function resetDiagnostics() {
  history = [];
  lastRun = null;
  laplacianResult = null;
  if (dom.showLaplacian.checked) dom.showLaplacian.checked = false;
  baseline = getBaseline();
  history.push(baseline);
  currentReport = analyzeConstraints(mesh, { fixedVertices: mesh.fixed, target });
  dom.iterationLabel.textContent = `迭代 0 / ${dom.maxIterations.value}`;
  updateMetrics(baseline);
  updateComponentReport(currentReport);
  updateStopRecord(null);
  updateComparison(baseline, null);
  drawChart();
  setStatus("idle", "等待拖动");
}

function loadPreset(id) {
  cancelAnimation();
  const fresh = createPresets().find((candidate) => candidate.id === id);
  if (!fresh) return;
  presets.set(id, fresh);
  mesh = fresh;
  resetMesh(mesh);
  anchorPositions = new Map();
  syncTargetToControl();
  setPresetButton(id);
  dom.meshKind.textContent = `PRESET / ${mesh.id.toUpperCase()}`;
  dom.meshTitle.textContent = mesh.name;
  dom.meshDescription.textContent = mesh.description;
  resetDiagnostics();
  fitView();
  renderCanvas();
  showToast(`已载入「${mesh.name}」，${mesh.fixed.size} 个固定顶点`);
}

function resetCurrentMesh() {
  cancelAnimation();
  resetMesh(mesh);
  syncTargetToControl();
  anchorPositions = new Map();
  resetDiagnostics();
  renderCanvas();
  showToast("网格已回到静止形状");
}

function resizeCanvas() {
  const rect = viewport.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  view.width = Math.max(1, rect.width);
  view.height = Math.max(1, rect.height);
  canvas.width = Math.round(view.width * ratio);
  canvas.height = Math.round(view.height * ratio);
  canvas.style.width = `${view.width}px`;
  canvas.style.height = `${view.height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (!view.ready) fitView();
}

function resizeChart() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = chart.getBoundingClientRect();
  chart.width = Math.max(1, Math.round(rect.width * ratio));
  chart.height = Math.max(1, Math.round(rect.height * ratio));
  chartContext.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function fitView() {
  const bounds = meshBounds(mesh, mesh.rest);
  const extraWidth = Math.max(bounds.width, 1);
  const extraHeight = Math.max(bounds.height, 1);
  view.scale = Math.min(
    (view.width * 0.78) / extraWidth,
    (view.height * 0.7) / extraHeight,
    120,
  );
  view.centerX = (bounds.minX + bounds.maxX) * 0.5;
  view.centerY = (bounds.minY + bounds.maxY) * 0.5;
  view.ready = true;
}

function worldToScreen(x, y) {
  return {
    x: view.width * 0.5 + (x - view.centerX) * view.scale,
    y: view.height * 0.5 - (y - view.centerY) * view.scale,
  };
}

function screenToWorld(x, y) {
  return {
    x: view.centerX + (x - view.width * 0.5) / view.scale,
    y: view.centerY - (y - view.height * 0.5) / view.scale,
  };
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pickVertex(point) {
  let best = null;
  let bestDistance = 15;
  for (let index = 0; index < mesh.positions.length / 2; index += 1) {
    const screen = worldToScreen(mesh.positions[index * 2], mesh.positions[index * 2 + 1]);
    const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function drawPolyline(positions, edges, strokeStyle, lineWidth, dash = []) {
  context.save();
  context.beginPath();
  for (const edge of edges) {
    const a = worldToScreen(positions[edge.a * 2], positions[edge.a * 2 + 1]);
    const b = worldToScreen(positions[edge.b * 2], positions[edge.b * 2 + 1]);
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
  }
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.setLineDash(dash);
  context.stroke();
  context.restore();
}

function fillTriangles(positions, triangles, fillStyle, strokeStyle = null) {
  context.beginPath();
  for (const triangle of triangles) {
    const a = worldToScreen(positions[triangle[0] * 2], positions[triangle[0] * 2 + 1]);
    const b = worldToScreen(positions[triangle[1] * 2], positions[triangle[1] * 2 + 1]);
    const c = worldToScreen(positions[triangle[2] * 2], positions[triangle[2] * 2 + 1]);
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.lineTo(c.x, c.y);
    context.closePath();
  }
  context.fillStyle = fillStyle;
  context.fill();
  if (strokeStyle) {
    context.strokeStyle = strokeStyle;
    context.lineWidth = 0.7;
    context.stroke();
  }
}

function unconstrainedVertexMask(report) {
  const mask = new Uint8Array(mesh.positions.length / 2);
  if (!report) return mask;
  for (const component of report.skipped) {
    for (const index of component.vertices) mask[index] = 1;
  }
  return mask;
}

function drawComponentLabels(mask, report) {
  if (!report?.skipped.length) return;
  for (const component of report.skipped) {
    let x = 0;
    let y = 0;
    for (const index of component.vertices) {
      x += mesh.positions[index * 2];
      y += mesh.positions[index * 2 + 1];
    }
    const screen = worldToScreen(x / component.vertices.length, y / component.vertices.length);
    const label = `C${component.componentIndex + 1} · 无约束`;
    context.save();
    context.font = '600 9px "Noto Sans SC UI", "SFMono-Regular", monospace';
    const width = context.measureText(label).width + 14;
    context.fillStyle = "rgba(73, 33, 20, 0.86)";
    context.fillRect(screen.x - width * 0.5, screen.y - 9, width, 18);
    context.strokeStyle = "rgba(244, 119, 63, 0.65)";
    context.strokeRect(screen.x - width * 0.5, screen.y - 9, width, 18);
    context.fillStyle = "#ffc3a7";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, screen.x, screen.y + 0.5);
    context.restore();
  }
}

function drawControlHandle(point, active = false) {
  const screen = worldToScreen(point.x, point.y);
  context.save();
  if (active) {
    context.beginPath();
    context.arc(screen.x, screen.y, 15, 0, Math.PI * 2);
    context.fillStyle = "rgba(244, 119, 63, 0.12)";
    context.fill();
  }
  context.translate(screen.x, screen.y);
  context.rotate(Math.PI / 4);
  context.fillStyle = "#f4773f";
  context.strokeStyle = "#ffe0cf";
  context.lineWidth = 1.5;
  context.fillRect(-6, -6, 12, 12);
  context.strokeRect(-6, -6, 12, 12);
  context.restore();
}

function drawVertices() {
  context.save();
  for (let index = 0; index < mesh.positions.length / 2; index += 1) {
    if (index === mesh.control || mesh.fixed.has(index)) continue;
    const screen = worldToScreen(mesh.positions[index * 2], mesh.positions[index * 2 + 1]);
    context.beginPath();
    context.arc(screen.x, screen.y, 1.05, 0, Math.PI * 2);
    context.fillStyle = "rgba(196, 221, 211, 0.38)";
    context.fill();
  }
  context.restore();
}

function drawPinnedVertices() {
  for (const index of mesh.fixed) {
    const screen = worldToScreen(mesh.positions[index * 2], mesh.positions[index * 2 + 1]);
    context.save();
    context.translate(screen.x, screen.y);
    context.fillStyle = "#0c191c";
    context.strokeStyle = "#61c8fa";
    context.lineWidth = 1.35;
    context.fillRect(-4.5, -4.5, 9, 9);
    context.strokeRect(-4.5, -4.5, 9, 9);
    context.beginPath();
    context.arc(0, 0, 1.3, 0, Math.PI * 2);
    context.fillStyle = "#61c8fa";
    context.fill();
    context.restore();
  }
}

function drawScaleBar() {
  const unit = view.scale;
  const length = unit >= 40 ? unit : unit * 5;
  const label = unit >= 40 ? "1 unit" : "5 units";
  const x = 17;
  const y = view.height - 19;
  context.save();
  context.strokeStyle = "rgba(194, 214, 205, 0.42)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + length, y);
  context.moveTo(x, y - 3);
  context.lineTo(x, y + 3);
  context.moveTo(x + length, y - 3);
  context.lineTo(x + length, y + 3);
  context.stroke();
  context.fillStyle = "rgba(194, 214, 205, 0.55)";
  context.font = '8px "SFMono-Regular", monospace';
  context.fillText(label, x, y - 7);
  context.restore();
}

function renderCanvas() {
  if (!view.ready) return;
  context.clearRect(0, 0, view.width, view.height);
  const edges = buildEdges(mesh);
  const report = currentReport || analyzeConstraints(mesh, { fixedVertices: mesh.fixed, target });
  const mask = unconstrainedVertexMask(report);

  drawPolyline(mesh.rest, edges, "rgba(142, 167, 155, 0.19)", 0.8, [2, 3]);

  const constrainedFaces = [];
  const missingFaces = [];
  for (const triangle of mesh.triangles) {
    if (triangle.some((index) => mask[index])) missingFaces.push(triangle);
    else constrainedFaces.push(triangle);
  }
  fillTriangles(mesh.positions, constrainedFaces, "rgba(19, 181, 140, 0.075)");
  fillTriangles(mesh.positions, missingFaces, "rgba(244, 119, 63, 0.055)");

  const constrainedEdges = edges.filter((edge) => !mask[edge.a] && !mask[edge.b]);
  const missingEdges = edges.filter((edge) => mask[edge.a] || mask[edge.b]);
  drawPolyline(mesh.positions, constrainedEdges, "rgba(58, 208, 166, 0.56)", 0.85);
  drawPolyline(mesh.positions, missingEdges, "rgba(232, 128, 84, 0.45)", 0.8, [3, 3]);

  if (dom.showLaplacian.checked && laplacianResult) {
    drawPolyline(laplacianResult.positions, edges, "rgba(231, 180, 62, 0.9)", 1.15, [6, 4]);
  }

  drawVertices();
  drawPinnedVertices();
  drawComponentLabels(mask, report);

  const controlPoint = {
    x: mesh.positions[mesh.control * 2],
    y: mesh.positions[mesh.control * 2 + 1],
  };
  const targetScreen = worldToScreen(target.x, target.y);
  const controlScreen = worldToScreen(controlPoint.x, controlPoint.y);
  if (Math.hypot(targetScreen.x - controlScreen.x, targetScreen.y - controlScreen.y) > 2) {
    context.save();
    context.beginPath();
    context.moveTo(controlScreen.x, controlScreen.y);
    context.lineTo(targetScreen.x, targetScreen.y);
    context.strokeStyle = "rgba(244, 119, 63, 0.65)";
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.stroke();
    context.restore();
  }
  drawControlHandle(target, dragging);
  if (dragging) {
    context.save();
    context.beginPath();
    context.arc(controlScreen.x, controlScreen.y, 4, 0, Math.PI * 2);
    context.strokeStyle = "rgba(244, 119, 63, 0.6)";
    context.stroke();
    context.restore();
  }
  drawScaleBar();
}

function updateMetrics(step) {
  if (!step) return;
  dom.energy.textContent = formatNumber(step.energy, 4);
  dom.residual.textContent = formatResidual(step.rigidRms);
  dom.drift.textContent = formatResidual(step.anchorDrift || 0);
  dom.stretch.textContent = Number.isFinite(step.maxStretch) ? `${step.maxStretch.toFixed(3)}×` : "—";
  const iteration = step.iteration || 0;
  dom.iterationLabel.textContent = `迭代 ${iteration} / ${dom.maxIterations.value}`;
}

function updateComponentReport(report) {
  dom.componentReport.textContent = "";
  if (!report) return;
  const list = document.createElement("div");
  list.className = "component-list";
  for (const component of report.components) {
    const item = document.createElement("div");
    item.className = `component-item${component.constrained ? "" : " missing"}`;
    const dot = document.createElement("i");
    const label = document.createElement("b");
    const count = component.vertices.filter((index) => mesh.fixed.has(index)).length;
    const hasControl = component.vertices.includes(target.index) ? 1 : 0;
    label.textContent = `C${component.componentIndex + 1} · ${component.constrained ? "已约束" : "缺少约束"}`;
    const detail = document.createElement("code");
    detail.textContent = component.constrained
      ? `${component.size}v / ${count} 固定${hasControl ? " + 控制" : ""}`
      : `${component.size}v / 保持原位`;
    item.append(dot, label, detail);
    list.append(item);
  }
  dom.componentReport.append(list);

  const skipped = report.skipped;
  dom.constraintWarning.classList.toggle("hidden", skipped.length === 0);
  if (skipped.length > 0) {
    const vertices = skipped.reduce((sum, component) => sum + component.size, 0);
    const ids = skipped.map((component) => `C${component.componentIndex + 1}`).join("、");
    dom.constraintWarning.textContent = `${ids} 缺少固定约束：${vertices} 个顶点保持原位，未进入刚性求解。`;
  }
}

function updateStopRecord(step) {
  dom.stopCard.classList.remove("warning");
  if (!step) {
    dom.stopReason.textContent = "尚未运行";
    dom.stopDetail.textContent = "拖动控制点并松手后记录停止条件。";
    return;
  }
  if (!step.stopReason) {
    dom.stopReason.textContent = "迭代中…";
    dom.stopDetail.textContent = `已执行 ${step.iteration} 次局部旋转 / 全局位置交替。`;
    return;
  }
  dom.stopReason.textContent = step.stopLabel;
  if (step.stopReason === "missing_constraints") {
    dom.stopCard.classList.add("warning");
    dom.stopDetail.textContent = "所有连通分量都没有固定点或控制点，线性系统奇异，已安全跳过。";
    return;
  }
  if (step.stopReason === "max_iterations") {
    dom.stopCard.classList.add("warning");
    dom.stopDetail.textContent = `达到 ${step.iteration} 次上限；固定点漂移 ${formatResidual(step.anchorDrift)}。`;
    return;
  }
  dom.stopDetail.textContent = `${step.iteration} 次迭代 · ΔE/E = ${formatResidual(
    step.relativeEnergyChange,
  )} · 残差 ${formatResidual(step.rigidRms)}。`;
}

function updateComparison(arapStep, laplacian) {
  dom.compareArapEnergy.textContent = arapStep ? formatNumber(arapStep.energy, 3) : "—";
  dom.compareArapResidual.textContent = arapStep ? formatResidual(arapStep.rigidRms) : "—";
  dom.compareLapEnergy.textContent = laplacian ? formatNumber(laplacian.energy, 3) : "—";
  dom.compareLapResidual.textContent = laplacian ? formatResidual(laplacian.rigidRms) : "—";
}

function drawChart() {
  const width = chart.clientWidth;
  const height = chart.clientHeight;
  if (!width || !height) return;
  chartContext.clearRect(0, 0, width, height);
  chartContext.save();
  chartContext.strokeStyle = "rgba(23, 32, 29, 0.07)";
  chartContext.lineWidth = 1;
  for (let row = 0; row <= 3; row += 1) {
    const y = 9 + (row / 3) * (height - 25);
    chartContext.beginPath();
    chartContext.moveTo(5, y);
    chartContext.lineTo(width - 5, y);
    chartContext.stroke();
  }

  const points = history.filter((step) => Number.isFinite(step.energy));
  if (points.length < 2) {
    chartContext.fillStyle = "#a8afa9";
    chartContext.font = '9px "Noto Sans SC UI", "SFMono-Regular", monospace';
    chartContext.textAlign = "center";
    chartContext.fillText("等待首次迭代", width * 0.5, height * 0.52);
    chartContext.restore();
    return;
  }

  const maxIteration = Math.max(
    2,
    Number(dom.maxIterations.value) || 60,
    points[points.length - 1].iteration || 0,
  );
  const values = [];
  for (const point of points) {
    values.push(Math.max(point.energy, 1e-12), Math.max(point.rigidRms, 1e-12));
  }
  let low = Math.log10(Math.min(...values));
  let high = Math.log10(Math.max(...values));
  if (high - low < 0.5) {
    low -= 0.25;
    high += 0.25;
  }
  const plot = { left: 5, right: width - 5, top: 9, bottom: height - 16 };
  const xFor = (iteration) => plot.left + (iteration / maxIteration) * (plot.right - plot.left);
  const yFor = (value) => {
    const normalized = (Math.log10(Math.max(value, 1e-12)) - low) / Math.max(high - low, 1e-9);
    return plot.bottom - normalized * (plot.bottom - plot.top);
  };

  const drawLine = (key, color, dash = []) => {
    chartContext.beginPath();
    points.forEach((point, index) => {
      const x = xFor(point.iteration || 0);
      const y = yFor(point[key]);
      if (index === 0) chartContext.moveTo(x, y);
      else chartContext.lineTo(x, y);
    });
    chartContext.strokeStyle = color;
    chartContext.lineWidth = 1.6;
    chartContext.setLineDash(dash);
    chartContext.stroke();
  };

  drawLine("energy", "#13a884");
  drawLine("rigidRms", "#e57643", [4, 3]);

  const last = points[points.length - 1];
  chartContext.setLineDash([]);
  for (const [key, color] of [
    ["energy", "#0c8a69"],
    ["rigidRms", "#d96332"],
  ]) {
    chartContext.beginPath();
    chartContext.arc(xFor(last.iteration || 0), yFor(last[key]), 2.4, 0, Math.PI * 2);
    chartContext.fillStyle = color;
    chartContext.fill();
  }

  chartContext.fillStyle = "#a8afa9";
  chartContext.font = '8px "SFMono-Regular", monospace';
  chartContext.textAlign = "left";
  chartContext.fillText("0", plot.left, height - 3);
  chartContext.textAlign = "right";
  chartContext.fillText(String(maxIteration), plot.right, height - 3);
  chartContext.restore();
}

function stepSummary(step) {
  return {
    iteration: step.iteration,
    energy: step.energy,
    rigidRms: step.rigidRms,
    rigidMax: step.rigidMax,
    rigidEnergy: step.rigidEnergy,
    maxStretch: step.maxStretch,
    anchorDrift: step.anchorDrift,
    relativeEnergyChange: step.relativeEnergyChange,
    stopReason: step.stopReason,
    stopLabel: step.stopLabel,
  };
}

function calculateLaplacian(referenceStep = lastRun || baseline) {
  if (!target) return;
  laplacianResult = solveLaplacian(mesh, {
    fixedVertices: mesh.fixed,
    target,
    positions: mesh.rest,
    anchorPositions,
  });
  updateComparison(referenceStep, laplacianResult);
  renderCanvas();
}

function finishSolve(step) {
  animationTimer = null;
  activeGenerator = null;
  calculateLaplacian(step);
  updateMetrics(step);
  updateStopRecord(step);
  drawChart();
  renderCanvas();
  const success = step.stopReason !== "missing_constraints" && step.stopReason !== "max_iterations";
  setStatus(success ? "done" : "warning", success ? `已停止 · ${step.iteration} 次` : "停止 · 检查记录");
  if (step.stopReason === "missing_constraints") {
    showToast("没有任何分量具备固定约束，求解已安全跳过");
  } else if (step.stopReason === "max_iterations") {
    showToast(`达到最大迭代次数；已记录停止原因与固定点漂移`);
  }
}

function advanceSolve() {
  animationTimer = null;
  if (!activeGenerator) return;
  const next = activeGenerator.next();
  if (next.done) {
    if (lastRun) finishSolve(lastRun);
    return;
  }
  const step = next.value;
  mesh.positions = step.positions;
  lastRun = step;
  currentReport = step.componentReport;
  const summary = stepSummary(step);
  if (step.iteration === 0) history[0] = summary;
  else history.push(summary);
  updateMetrics(step);
  updateComponentReport(currentReport);
  updateStopRecord(step.done ? step : { ...summary, stopLabel: null });
  drawChart();
  renderCanvas();
  if (step.done) {
    finishSolve(step);
    return;
  }
  setStatus("running", `迭代 ${step.iteration} / ${dom.maxIterations.value}`);
  animationTimer = setTimeout(advanceSolve, 34);
}

function startSolve() {
  cancelAnimation();
  if (mesh.fixed.has(mesh.control)) {
    showToast("控制点处于固定状态，请先切换为可拖动顶点");
    setStatus("warning", "控制点被固定");
    return;
  }
  baseline = getBaseline();
  history = [stepSummary(baseline)];
  lastRun = null;
  laplacianResult = null;
  currentReport = analyzeConstraints(mesh, { fixedVertices: mesh.fixed, target });
  updateComponentReport(currentReport);
  updateComparison(null, null);
  updateStopRecord(null);
  setStatus("running", `迭代 0 / ${dom.maxIterations.value}`);
  activeGenerator = arapIterations(mesh, {
    fixedVertices: new Set(mesh.fixed),
    target: { ...target },
    positions: mesh.positions,
    anchorPositions,
    maxIterations: Number(dom.maxIterations.value),
    energyTolerance: Number(dom.energyTolerance.value),
    rigidTolerance: Number(dom.rigidTolerance.value),
  });
  advanceSolve();
}

function replacementControl(excluded) {
  let best = -1;
  let bestScore = -Infinity;
  for (let index = 0; index < mesh.positions.length / 2; index += 1) {
    if (index === excluded || mesh.fixed.has(index)) continue;
    const score = mesh.positions[index * 2] - Math.abs(mesh.positions[index * 2 + 1]) * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

function togglePin(index) {
  if (mesh.fixed.has(index)) {
    mesh.fixed.delete(index);
    anchorPositions.delete(index);
  } else {
    if (mesh.fixed.size >= mesh.positions.length / 2 - 1) {
      showToast("至少保留一个可拖动控制点");
      return;
    }
    mesh.fixed.add(index);
    anchorPositions.set(index, {
      x: mesh.positions[index * 2],
      y: mesh.positions[index * 2 + 1],
    });
    if (index === mesh.control) {
      const next = replacementControl(index);
      if (next >= 0) {
        mesh.control = next;
        syncTargetToControl();
      }
    }
  }
  cancelAnimation();
  resetDiagnostics();
  renderCanvas();
  showToast(
    mesh.fixed.has(index)
      ? `顶点 ${index} 已固定；求解时坐标被强制锁定`
      : `顶点 ${index} 已解除固定`,
  );
}

function beginDrag(point, existingHandle, pointerId) {
  dragging = true;
  dragPointerId = pointerId ?? null;
  dragDistance = 0;
  dragStartPoint = { x: point.x, y: point.y };
  if (existingHandle) {
    const world = screenToWorld(point.x, point.y);
    dragOffset = { x: target.x - world.x, y: target.y - world.y };
  } else {
    dragOffset = { x: 0, y: 0 };
  }
  if (dragPointerId !== null) canvas.setPointerCapture(dragPointerId);
  renderCanvas();
}

function handlePointerDown(event) {
  if (event.button !== 0) return;
  const point = pointerPosition(event);
  if (tool === "pin") {
    const index = pickVertex(point);
    if (index === null) {
      showToast("请点击网格顶点");
      return;
    }
    togglePin(index);
    return;
  }

  const targetScreen = worldToScreen(target.x, target.y);
  if (Math.hypot(targetScreen.x - point.x, targetScreen.y - point.y) <= 17) {
    beginDrag(point, true, event.pointerId);
    return;
  }

  const picked = pickVertex(point);
  if (picked === null) return;
  if (mesh.fixed.has(picked)) {
    showToast(`顶点 ${picked} 已被固定；在固定模式下可解除约束`);
    return;
  }
  mesh.control = picked;
  target = {
    index: picked,
    x: mesh.positions[picked * 2],
    y: mesh.positions[picked * 2 + 1],
  };
  currentReport = analyzeConstraints(mesh, { fixedVertices: mesh.fixed, target });
  updateComponentReport(currentReport);
  beginDrag(point, false, event.pointerId);
}

function handlePointerMove(event) {
  if (!dragging || (dragPointerId !== null && event.pointerId !== dragPointerId)) return;
  const point = pointerPosition(event);
  dragDistance = Math.max(dragDistance, Math.hypot(point.x - dragStartPoint.x, point.y - dragStartPoint.y));
  const world = screenToWorld(point.x, point.y);
  target.x = world.x + dragOffset.x;
  target.y = world.y + dragOffset.y;
  setStatus("idle", `目标 (${target.x.toFixed(2)}, ${target.y.toFixed(2)})`);
  renderCanvas();
}

function handlePointerUp(event) {
  if (!dragging) return;
  if (dragPointerId !== null && canvas.hasPointerCapture(dragPointerId)) {
    canvas.releasePointerCapture(dragPointerId);
  }
  dragging = false;
  dragPointerId = null;
  if (dragDistance > 3) {
    setStatus("running", "开始交替求解");
    startSolve();
  } else {
    currentReport = analyzeConstraints(mesh, { fixedVertices: mesh.fixed, target });
    updateComponentReport(currentReport);
    renderCanvas();
    setStatus("idle", "控制点已就位");
  }
}

function handlePointerCancel() {
  dragging = false;
  dragPointerId = null;
  renderCanvas();
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportOBJ() {
  const text = meshToOBJ(mesh, mesh.positions, {
    title: mesh.name,
    stopReason: lastRun?.stopLabel || "尚未运行 ARAP",
    iterations: lastRun?.iteration ?? 0,
    energy: lastRun?.energy ?? baseline?.energy,
    rigidResidual: lastRun?.rigidRms ?? baseline?.rigidRms,
  });
  downloadText(`${mesh.id}-deformed.obj`, text, "text/plain");
  showToast("已导出变形网格 OBJ（含约束与收敛注释）");
}

function exportReport() {
  const current = lastRun || baseline;
  const payload = {
    schema: "arap-mesh-studio/v1",
    exportedAt: new Date().toISOString(),
    mesh: {
      id: mesh.id,
      name: mesh.name,
      vertices: mesh.positions.length / 2,
      triangles: mesh.triangles.length,
      positions: Array.from({ length: mesh.positions.length / 2 }, (_, index) => ({
        x: mesh.positions[index * 2],
        y: mesh.positions[index * 2 + 1],
      })),
    },
    control: {
      index: mesh.control,
      target: { x: target.x, y: target.y },
    },
    fixedVertices: [...mesh.fixed],
    solver: {
      weights: "uniform-edge",
      localStep: "nearest-2d-rotation",
      globalStep: "hard-constrained-laplacian",
      maxIterations: Number(dom.maxIterations.value),
      energyTolerance: Number(dom.energyTolerance.value),
      rigidTolerance: Number(dom.rigidTolerance.value),
    },
    convergence: {
      stopReason: current?.stopReason || "not_run",
      stopLabel: current?.stopLabel || "尚未运行",
      iterations: current?.iteration || 0,
      energy: current?.energy ?? null,
      rigidRms: current?.rigidRms ?? null,
      fixedPointDrift: current?.anchorDrift ?? 0,
    },
    components: currentReport?.components.map((component) => ({
      id: `C${component.componentIndex + 1}`,
      vertices: component.size,
      constrained: component.constrained,
      anchors: component.anchorIndices,
      status: component.status,
    })),
    missingConstraintComponents: currentReport?.skipped.map((component) => ({
      id: `C${component.componentIndex + 1}`,
      vertices: component.size,
    })),
    history,
    laplacian: laplacianResult
      ? {
          energy: laplacianResult.energy,
          rigidRms: laplacianResult.rigidRms,
          fixedPointDrift: laplacianResult.anchorDrift,
        }
      : null,
  };
  downloadText(
    `${mesh.id}-arap-report.json`,
    JSON.stringify(payload, null, 2),
    "application/json",
  );
  showToast("已导出求解报告与逐次迭代记录");
}

function handleLaplacianToggle() {
  if (dom.showLaplacian.checked) {
    if (!laplacianResult) calculateLaplacian(lastRun || baseline);
    else updateComparison(lastRun || baseline, laplacianResult);
    renderCanvas();
  } else {
    renderCanvas();
  }
}

function handleResize() {
  resizeCanvas();
  fitView();
  resizeChart();
  renderCanvas();
  drawChart();
}

function initialize() {
  dom.presetList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (button) loadPreset(button.dataset.preset);
  });

  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });

  $("resetMesh").addEventListener("click", resetCurrentMesh);
  $("runSolver").addEventListener("click", () => {
    if (dragging) return;
    startSolve();
  });
  $("exportObj").addEventListener("click", exportOBJ);
  $("exportReport").addEventListener("click", exportReport);
  dom.showLaplacian.addEventListener("change", handleLaplacianToggle);

  dom.maxIterations.addEventListener("input", () => {
    dom.maxIterationsValue.textContent = dom.maxIterations.value;
    if (lastRun) dom.iterationLabel.textContent = `迭代 ${lastRun.iteration} / ${dom.maxIterations.value}`;
    drawChart();
  });

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerCancel);

  let resizeFrame = null;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(handleResize);
  });
  const viewportObserver = new ResizeObserver(handleResize);
  viewportObserver.observe(viewport);
  const chartObserver = new ResizeObserver(() => {
    resizeChart();
    drawChart();
  });
  chartObserver.observe(chart);

  resizeCanvas();
  resizeChart();
  setTool("drag", false);
  loadPreset("strip");
  document.fonts?.ready.then(() => {
    renderCanvas();
    drawChart();
  });
  requestAnimationFrame(() => {
    resizeCanvas();
    fitView();
    renderCanvas();
    drawChart();
  });
}

initialize();
