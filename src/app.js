import { alignClips } from "./alignment.js";
import {
  DtwInputError,
  clipDuration,
  computeLocalCostMatrix,
  normalizeClip,
  parseClipJSON,
  validateAnchors,
} from "./dtw.js";
import { drawCostMatrix, drawSparkline, hitTestMatrix } from "./matrix.js";
import { resampledClipToJSON, resampleSegment } from "./resample.js";
import { SCENARIOS, getScenario } from "./samples.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  scenarioTabs: $("#scenario-tabs"),
  scenarioNote: $("#scenario-note"),
  matrixCanvas: $("#matrix-canvas"),
  matrixTooltip: $("#matrix-tooltip"),
  matrixShape: $("#matrix-shape"),
  matrixPath: $("#matrix-path"),
  matrixHint: $("#matrix-hint"),
  alignmentError: $("#alignment-error"),
  sparkA: $("#spark-a"),
  sparkB: $("#spark-b"),
  anchorCount: $("#anchor-count"),
  anchorRef: $("#anchor-ref"),
  anchorTarget: $("#anchor-target"),
  addAnchor: $("#add-anchor"),
  anchorError: $("#anchor-error"),
  anchorList: $("#anchor-list"),
  selectedCell: $("#selected-cell"),
  clearAnchors: $("#clear-anchors"),
  endpointStart: $("#endpoint-start"),
  endpointEnd: $("#endpoint-end"),
  meanCost: $("#mean-cost"),
  pathLength: $("#path-length"),
  stepCounts: $("#step-counts"),
  status: $(".status-pill"),
  histogram: $("#stretch-histogram"),
  stretchMin: $("#stretch-min"),
  stretchP10: $("#stretch-p10"),
  stretchMedian: $("#stretch-median"),
  stretchP90: $("#stretch-p90"),
  stretchMax: $("#stretch-max"),
  segmentCount: $("#segment-count"),
  segmentSelect: $("#segment-select"),
  segmentFrames: $("#segment-frames"),
  resampleButton: $("#resample-button"),
  resampleResult: $("#resample-result"),
  resampleTitle: $("#resample-title"),
  resampleDetail: $("#resample-detail"),
  downloadResample: $("#download-resample"),
  downloadReport: $("#download-report"),
  importDialog: $("#import-dialog"),
  importTitle: $("#import-title"),
  importText: $("#import-text"),
  importFile: $("#import-file"),
  importError: $("#import-error"),
  applyImport: $("#apply-import"),
  toast: $("#toast"),
};

const state = {
  scenarioKey: "speed",
  reference: null,
  target: null,
  anchors: [],
  alignment: null,
  costMatrix: null,
  selected: null,
  hover: null,
  segmentIndex: 0,
  resampleResult: null,
  error: null,
  importTarget: "reference",
};

let drawFrame = 0;
let toastTimer = 0;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
}

function renderScenarioTabs() {
  elements.scenarioTabs.replaceChildren();
  for (const scenario of SCENARIOS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scenario-tab";
    button.dataset.key = scenario.key;
    button.innerHTML = `<span>${scenario.label}</span><small>${scenario.note}</small>`;
    button.addEventListener("click", () => loadScenario(scenario.key));
    elements.scenarioTabs.append(button);
  }
}

function setActiveScenario(key) {
  elements.scenarioTabs.querySelectorAll(".scenario-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.key === key);
  });
}

function loadScenario(key) {
  const scenario = getScenario(key);
  try {
    state.reference = normalizeClip(scenario.reference, "reference");
    state.target = normalizeClip(scenario.target, "target");
  } catch (error) {
    showToast(error.message);
    return;
  }
  state.scenarioKey = key;
  state.anchors = scenario.anchors.map((anchor) => ({ ...anchor }));
  state.selected = null;
  state.hover = null;
  state.resampleResult = null;
  const suggested = state.anchors.at(-1);
  elements.anchorRef.value = String(
    suggested?.ref ?? Math.floor((state.reference.frames.length - 1) / 2),
  );
  elements.anchorTarget.value = String(
    suggested?.target ?? Math.floor((state.target.frames.length - 1) / 2),
  );
  elements.scenarioNote.textContent = scenario.description;
  setActiveScenario(key);
  recompute();
  if (state.error) {
    showToast(
      state.error.code === "ANCHOR_ORDER_CONFLICT"
        ? "锚点顺序冲突，已拒绝对齐"
        : state.error.message,
    );
  }
}

function recompute() {
  state.resampleResult = null;
  try {
    const alignment = alignClips(state.reference, state.target, { anchors: state.anchors });
    state.alignment = alignment;
    state.costMatrix = alignment.costMatrix;
    state.anchors = alignment.anchors.map((anchor) => ({ ...anchor }));
    state.error = null;
  } catch (error) {
    state.alignment = null;
    state.error = error;
    try {
      state.costMatrix = computeLocalCostMatrix(state.reference, state.target);
    } catch {
      state.costMatrix = null;
    }
  }
  const segments = state.alignment?.segments.length ?? 0;
  state.segmentIndex = Math.min(state.segmentIndex, Math.max(0, segments - 1));
  renderAll();
}

function renderAll() {
  renderClips();
  renderAnchors();
  renderMetrics();
  renderHistogram();
  renderSegments();
  renderMatrix();
}

function renderClips() {
  if (!state.reference || !state.target) return;
  for (const [prefix, clip] of [
    ["clip-a", state.reference],
    ["clip-b", state.target],
  ]) {
    $(`#${prefix}-name`).textContent = clip.name;
    $(`#${prefix}-frames`).textContent = String(clip.frames.length);
    $(`#${prefix}-duration`).textContent = `${clipDuration(clip).toFixed(2)}s`;
    $(`#${prefix}-joints`).textContent = `${clip.jointNames.length} · ${clip.dimensions}D`;
  }
  drawSparkline(elements.sparkA, state.reference, "#0f7770");
  drawSparkline(elements.sparkB, state.target, "#f06548");
  elements.anchorRef.max = String(state.reference.frames.length - 1);
  elements.anchorTarget.max = String(state.target.frames.length - 1);
  if (elements.anchorRef.value === "") {
    elements.anchorRef.value = String(Math.floor((state.reference.frames.length - 1) / 2));
  }
  if (elements.anchorTarget.value === "") {
    elements.anchorTarget.value = String(Math.floor((state.target.frames.length - 1) / 2));
  }
}

function renderAnchors() {
  elements.anchorList.replaceChildren();
  elements.anchorCount.textContent = String(state.anchors.length);
  if (state.anchors.length === 0) {
    const empty = document.createElement("span");
    empty.className = "anchor-empty";
    empty.textContent = "尚无自定义锚点。首尾端点始终锁定。";
    elements.anchorList.append(empty);
  }
  for (const anchor of state.anchors) {
    const chip = document.createElement("span");
    chip.className = "anchor-chip";
    chip.append(document.createTextNode(`A ${anchor.ref} ↔ B ${anchor.target}`));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "移除锚点";
    remove.addEventListener("click", () => {
      state.anchors = state.anchors.filter(
        (candidate) => candidate.ref !== anchor.ref || candidate.target !== anchor.target,
      );
      state.error = null;
      recompute();
    });
    chip.append(remove);
    elements.anchorList.append(chip);
  }

  if (state.selected) {
    elements.selectedCell.textContent = `已选 A ${state.selected.ref} × B ${state.selected.target}`;
  } else {
    elements.selectedCell.textContent = "未选择帧对";
  }
  const anchorIssue =
    state.error?.code === "ANCHOR_ORDER_CONFLICT" ||
    state.error?.code === "INVALID_ANCHOR" ||
    state.error?.code === "ANCHOR_OUT_OF_RANGE";
  elements.anchorError.hidden = !anchorIssue;
  if (anchorIssue) elements.anchorError.textContent = state.error.message;
}

function formatDistance(value) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0.0000";
  if (value < 0.001) return value.toExponential(2);
  return value.toFixed(4);
}

function renderMetrics() {
  const alignment = state.alignment;
  elements.status.textContent = state.error ? "REJECT" : "PASS";
  elements.status.classList.toggle("is-error", Boolean(state.error));
  elements.alignmentError.hidden = !state.error;
  if (state.error) {
    elements.alignmentError.textContent = `对齐失败：${state.error.message}`;
  }
  if (!alignment) {
    for (const element of [
      elements.endpointStart,
      elements.endpointEnd,
      elements.meanCost,
      elements.pathLength,
      elements.stepCounts,
    ]) {
      element.textContent = "—";
    }
    elements.matrixPath.textContent = "PATH —";
    return;
  }
  const metrics = alignment.metrics;
  elements.endpointStart.textContent = formatDistance(metrics.endpointError.start);
  elements.endpointEnd.textContent = formatDistance(metrics.endpointError.end);
  elements.meanCost.textContent = formatDistance(metrics.meanCost);
  elements.pathLength.textContent = `${metrics.pathLength} steps`;
  elements.stepCounts.textContent =
    `A ${metrics.steps.referenceHold} / B ${metrics.steps.targetHold}`;
  elements.matrixPath.textContent = `PATH ${metrics.pathLength}`;
}

function renderMatrix() {
  if (!state.costMatrix) return;
  elements.matrixShape.textContent = `${state.costMatrix.rows} × ${state.costMatrix.cols}`;
  const anchors = state.alignment?.resolvedAnchors ?? state.anchors;
  drawCostMatrix(elements.matrixCanvas, {
    costMatrix: state.costMatrix,
    path: state.alignment?.path,
    anchors,
    selected: state.selected,
    hover: state.hover,
  });
}

function renderHistogram() {
  elements.histogram.replaceChildren();
  const stretch = state.alignment?.stretch;
  const histogram = stretch?.histogram;
  const binCount = histogram?.bins.length ?? 12;
  const maxCount = Math.max(1, ...(histogram?.bins.map((bin) => bin.count) ?? []));
  for (let index = 0; index < binCount; index += 1) {
    const bin = histogram?.bins[index];
    const bar = document.createElement("div");
    bar.className = "hist-bar";
    const fill = document.createElement("i");
    const percentage = bin ? Math.max(2, (bin.count / maxCount) * 92) : 2;
    fill.style.height = `${percentage}%`;
    bar.append(fill);
    if (bin) {
      bar.title = `${bin.from.toFixed(2)}–${bin.to.toFixed(2)} ×：${bin.count} 帧`;
    }
    if (index === 0 || index === Math.floor(binCount / 2) || index === binCount - 1) {
      const label = document.createElement("span");
      label.textContent = bin ? bin.from.toFixed(1) : "";
      bar.append(label);
    }
    elements.histogram.append(bar);
  }

  const stats = stretch?.stats;
  elements.stretchMin.textContent = stats ? `${stats.min.toFixed(2)}×` : "—";
  elements.stretchP10.textContent = stats ? `${stats.p10.toFixed(2)}×` : "—";
  elements.stretchMedian.textContent = stats ? `${stats.median.toFixed(2)}×` : "—";
  elements.stretchP90.textContent = stats ? `${stats.p90.toFixed(2)}×` : "—";
  elements.stretchMax.textContent = stats ? `${stats.max.toFixed(2)}×` : "—";
}

function defaultSegmentFrames(segment) {
  return Math.max(1, segment.end.ref - segment.start.ref + 1);
}

function renderSegments() {
  const segments = state.alignment?.segments ?? [];
  elements.segmentCount.textContent = String(segments.length);
  elements.segmentSelect.replaceChildren();
  if (segments.length === 0) {
    const option = document.createElement("option");
    option.textContent = state.error ? "锚点未通过校验" : "无可重采样片段";
    elements.segmentSelect.append(option);
    elements.segmentSelect.disabled = true;
    elements.segmentFrames.disabled = true;
    elements.segmentFrames.value = "";
    elements.resampleButton.disabled = true;
    elements.resampleResult.hidden = true;
    return;
  }
  elements.segmentSelect.disabled = false;
  elements.segmentFrames.disabled = false;
  elements.resampleButton.disabled = false;
  segments.forEach((segment, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent =
      `片段 ${index + 1} · A ${segment.start.ref}–${segment.end.ref} / ` +
      `B ${segment.start.target}–${segment.end.target}`;
    elements.segmentSelect.append(option);
  });
  state.segmentIndex = Math.min(state.segmentIndex, segments.length - 1);
  elements.segmentSelect.value = String(state.segmentIndex);
  elements.segmentFrames.value = String(defaultSegmentFrames(segments[state.segmentIndex]));
  elements.segmentFrames.max = String(Math.max(1, defaultSegmentFrames(segments[state.segmentIndex]) * 8));
  renderResampleResult();
}

function renderResampleResult() {
  const result = state.resampleResult;
  elements.resampleResult.hidden = !result;
  if (!result) return;
  const duration = result.frames.at(-1).time - result.frames[0].time;
  elements.resampleTitle.textContent = `${result.frameCount} 帧重采样完成`;
  elements.resampleDetail.textContent =
    `片段 ${result.segmentIndex + 1} · A ${result.referenceRange.from}–${result.referenceRange.to} / ` +
    `B ${result.targetRange.from}–${result.targetRange.to} · ${duration.toFixed(2)}s`;
}

function showAnchorError(error) {
  elements.anchorError.hidden = false;
  elements.anchorError.textContent = error.message;
  elements.status.textContent = "REJECT";
  elements.status.classList.add("is-error");
  showToast(error.code === "ANCHOR_ORDER_CONFLICT" ? "锚点顺序冲突，已拒绝" : error.message);
}

function addAnchorFromInputs() {
  const ref = Number(elements.anchorRef.value);
  const target = Number(elements.anchorTarget.value);
  if (!Number.isInteger(ref) || !Number.isInteger(target)) {
    showAnchorError(new DtwInputError("锚点帧号必须是整数", "INVALID_ANCHOR"));
    return;
  }
  const candidate = [...state.anchors, { ref, target }].sort(
    (a, b) => a.ref - b.ref || a.target - b.target,
  );
  try {
    validateAnchors(candidate, state.reference.frames.length, state.target.frames.length);
  } catch (error) {
    showAnchorError(error);
    return;
  }
  state.anchors = candidate;
  state.selected = null;
  elements.anchorError.hidden = true;
  recompute();
  showToast(`已锁定 A ${ref} ↔ B ${target}`);
}

function selectCell(cell) {
  state.selected = cell;
  if (cell) {
    elements.anchorRef.value = String(cell.ref);
    elements.anchorTarget.value = String(cell.target);
    elements.matrixHint.innerHTML =
      `<span>已选 A ${cell.ref} × B ${cell.target}</span><span class="hint-dot"></span>` +
      "<span>点击“加入锚点”锁定</span>";
  }
  renderAnchors();
  queueMatrixDraw();
}

function queueMatrixDraw() {
  window.cancelAnimationFrame(drawFrame);
  drawFrame = window.requestAnimationFrame(renderMatrix);
}

function updateTooltip(event, cell) {
  if (!cell || !state.costMatrix) {
    elements.matrixTooltip.hidden = true;
    return;
  }
  const cost = state.costMatrix.values[cell.ref * state.costMatrix.cols + cell.target];
  const referenceTime = state.reference.frames[cell.ref].time;
  const targetTime = state.target.frames[cell.target].time;
  elements.matrixTooltip.innerHTML =
    `<strong>A ${cell.ref} × B ${cell.target}</strong><br>` +
    `DIST ${cost.toFixed(5)}<br>` +
    `${referenceTime.toFixed(3)}s / ${targetTime.toFixed(3)}s`;
  const wrap = elements.matrixCanvas.parentElement.getBoundingClientRect();
  let left = event.clientX - wrap.left + 14;
  let top = event.clientY - wrap.top + 12;
  if (left > wrap.width - 160) left -= 182;
  if (top > wrap.height - 86) top -= 82;
  elements.matrixTooltip.style.left = `${left}px`;
  elements.matrixTooltip.style.top = `${top}px`;
  elements.matrixTooltip.hidden = false;
}

function clipAsJSON(clip) {
  return {
    name: clip.name,
    fps: clip.fps,
    frames: clip.frames.map((frame) => ({
      time: frame.time,
      joints: Object.fromEntries(
        clip.jointNames.map((name, index) => [name, frame.positions[index]]),
      ),
    })),
  };
}

function downloadJSON(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildReport() {
  const alignment = state.alignment;
  return {
    generatedAt: new Date().toISOString(),
    scenario: state.scenarioKey,
    reference: {
      name: alignment.reference.name,
      frameCount: alignment.reference.frames.length,
      duration: alignment.metrics.referenceDuration,
      joints: alignment.reference.jointNames,
    },
    target: {
      name: alignment.target.name,
      frameCount: alignment.target.frames.length,
      duration: alignment.metrics.targetDuration,
      joints: alignment.target.jointNames,
    },
    anchors: alignment.anchors,
    resolvedAnchors: alignment.resolvedAnchors,
    path: alignment.path,
    metrics: alignment.metrics,
    stretch: {
      stats: alignment.stretch.stats,
      histogram: alignment.stretch.histogram,
      profile: alignment.stretch.profile,
    },
    segments: alignment.segments,
    costMatrix: {
      rows: alignment.costMatrix.rows,
      cols: alignment.costMatrix.cols,
      values: Array.from(alignment.costMatrix.values),
    },
    resampledSegment: state.resampleResult
      ? {
          segmentIndex: state.resampleResult.segmentIndex,
          referenceRange: state.resampleResult.referenceRange,
          targetRange: state.resampleResult.targetRange,
          correspondence: state.resampleResult.correspondence,
          clip: resampledClipToJSON(state.resampleResult),
        }
      : null,
  };
}

function bindEvents() {
  elements.addAnchor.addEventListener("click", addAnchorFromInputs);
  elements.anchorRef.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addAnchorFromInputs();
  });
  elements.anchorTarget.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addAnchorFromInputs();
  });
  elements.clearAnchors.addEventListener("click", () => {
    state.anchors = [];
    state.error = null;
    elements.anchorError.hidden = true;
    recompute();
    showToast("已清空自定义锚点");
  });

  elements.matrixCanvas.addEventListener("pointermove", (event) => {
    if (!state.costMatrix) return;
    const cell = hitTestMatrix(
      elements.matrixCanvas,
      event,
      state.costMatrix.rows,
      state.costMatrix.cols,
    );
    updateTooltip(event, cell);
    const changed =
      cell?.ref !== state.hover?.ref || cell?.target !== state.hover?.target;
    state.hover = cell;
    if (changed) queueMatrixDraw();
  });
  elements.matrixCanvas.addEventListener("pointerleave", () => {
    state.hover = null;
    elements.matrixTooltip.hidden = true;
    queueMatrixDraw();
  });
  elements.matrixCanvas.addEventListener("click", (event) => {
    if (!state.costMatrix) return;
    const cell = hitTestMatrix(
      elements.matrixCanvas,
      event,
      state.costMatrix.rows,
      state.costMatrix.cols,
    );
    if (cell) selectCell(cell);
  });

  elements.segmentSelect.addEventListener("change", () => {
    const segments = state.alignment?.segments ?? [];
    if (segments.length === 0) return;
    state.segmentIndex = Number(elements.segmentSelect.value);
    state.resampleResult = null;
    elements.segmentFrames.value = String(defaultSegmentFrames(segments[state.segmentIndex]));
    elements.segmentFrames.max = String(
      Math.max(1, defaultSegmentFrames(segments[state.segmentIndex]) * 8),
    );
    renderResampleResult();
  });

  elements.resampleButton.addEventListener("click", () => {
    if (!state.alignment) return;
    try {
      const frameCount = Number(elements.segmentFrames.value);
      state.resampleResult = resampleSegment(state.alignment, state.segmentIndex, {
        frameCount,
      });
      renderResampleResult();
      showToast("片段已重采样到 A 的时间轴");
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.downloadResample.addEventListener("click", () => {
    if (!state.resampleResult) return;
    const clip = resampledClipToJSON(state.resampleResult);
    downloadJSON(clip, `retake-segment-${state.resampleResult.segmentIndex + 1}.json`);
  });

  elements.downloadReport.addEventListener("click", () => {
    if (!state.alignment) {
      showToast("当前锚点未通过校验，无法导出对齐报告");
      return;
    }
    downloadJSON(buildReport(), `retake-dtw-report-${state.scenarioKey}.json`);
  });

  document.querySelectorAll("[data-import]").forEach((button) => {
    button.addEventListener("click", () => openImport(button.dataset.import));
  });
  elements.importFile.addEventListener("change", async () => {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    elements.importText.value = await file.text();
    elements.importError.hidden = true;
  });
  elements.applyImport.addEventListener("click", applyImport);
  elements.importDialog.addEventListener("close", () => {
    elements.importError.hidden = true;
    elements.importFile.value = "";
  });

  window.addEventListener("resize", () => {
    queueMatrixDraw();
    if (state.reference && state.target) {
      drawSparkline(elements.sparkA, state.reference, "#0f7770");
      drawSparkline(elements.sparkB, state.target, "#f06548");
    }
  });
}

function openImport(target) {
  state.importTarget = target;
  const clip = target === "reference" ? state.reference : state.target;
  elements.importTitle.textContent = target === "reference" ? "导入 A · 参考片段" : "导入 B · 目标片段";
  elements.importText.value = clip ? JSON.stringify(clipAsJSON(clip), null, 2) : "";
  elements.importError.hidden = true;
  elements.importDialog.showModal();
}

function applyImport() {
  if (!state.importTarget) return;
  try {
    const clip = parseClipJSON(elements.importText.value, state.importTarget);
    if (state.importTarget === "reference") state.reference = clip;
    else state.target = clip;
    state.anchors = [];
    state.selected = null;
    state.hover = null;
    state.segmentIndex = 0;
    state.error = null;
    elements.anchorRef.value = String(Math.floor((state.reference.frames.length - 1) / 2));
    elements.anchorTarget.value = String(Math.floor((state.target.frames.length - 1) / 2));
    elements.anchorError.hidden = true;
    elements.importDialog.close();
    recompute();
    if (state.error) showToast(state.error.message);
    else showToast(`已载入 ${clip.frames.length} 帧`);
  } catch (error) {
    elements.importError.hidden = false;
    elements.importError.textContent = error.message;
  }
}

renderScenarioTabs();
bindEvents();
loadScenario("speed");
if (state.error?.code === "ANCHOR_ORDER_CONFLICT") {
  showToast("锚点顺序冲突，已拒绝对齐");
}
