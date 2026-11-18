import { PRESETS, DEFAULT_PRESET } from "./presets.js";
import {
  DEFAULT_TOLERANCE,
  MAX_TOLERANCE,
  MIN_TOLERANCE,
  computeStraightSkeleton,
  getOffsetAt,
} from "./geometry.js";

const $ = (selector) => document.querySelector(selector);
const SVG_NS = "http://www.w3.org/2000/svg";

const elements = {
  presetGrid: $("#presetGrid"),
  pointInput: $("#pointInput"),
  applyPoints: $("#applyPoints"),
  inputError: $("#inputError"),
  vertexCount: $("#vertexCount"),
  distanceInput: $("#distanceInput"),
  distanceSlider: $("#distanceSlider"),
  distanceMaxLabel: $("#distanceMaxLabel"),
  playButton: $("#playButton"),
  playLabel: $("#playLabel"),
  prevEvent: $("#prevEvent"),
  nextEvent: $("#nextEvent"),
  resetPlayback: $("#resetPlayback"),
  stopAtEvents: $("#stopAtEvents"),
  toleranceInput: $("#toleranceInput"),
  toleranceNote: $("#toleranceNote"),
  collinearRemoved: $("#collinearRemoved"),
  timeTolerance: $("#timeTolerance"),
  auditStatus: $("#auditStatus"),
  shapeTitle: $("#shapeTitle"),
  componentMetric: $("#componentMetric"),
  areaMetric: $("#areaMetric"),
  intersectionMetric: $("#intersectionMetric"),
  eventMetric: $("#eventMetric"),
  scene: $("#scene"),
  gridRect: $("#gridRect"),
  worldGroup: $("#worldGroup"),
  skeletonLayer: $("#skeletonLayer"),
  originalLayer: $("#originalLayer"),
  offsetLayer: $("#offsetLayer"),
  eventLayer: $("#eventLayer"),
  handleLayer: $("#handleLayer"),
  distanceBadge: $("#distanceBadge"),
  timeBadge: $("#timeBadge"),
  canvasHint: $("#canvasHint"),
  componentStrip: $("#componentStrip"),
  queueCount: $("#queueCount"),
  splitCount: $("#splitCount"),
  collapseCount: $("#collapseCount"),
  maxSimultaneous: $("#maxSimultaneous"),
  queueStatus: $("#queueStatus"),
  queueTime: $("#queueTime"),
  queueProgressFill: $("#queueProgressFill"),
  eventList: $("#eventList"),
  queueNote: $("#queueNote"),
};

const state = {
  presetId: DEFAULT_PRESET.id,
  points: DEFAULT_PRESET.points.map((point) => ({ ...point })),
  tolerance: DEFAULT_TOLERANCE,
  result: null,
  distance: DEFAULT_PRESET.targetDistance,
  currentEventIndex: -1,
  playing: false,
  animationFrame: null,
  lastFrameTime: 0,
  dragIndex: null,
  dragMoved: false,
  recomputeFrame: null,
};

const PRESET_ICONS = {
  convex:
    '<svg viewBox="0 0 24 24"><path d="M5 18 3 9l7-5 9 2 2 8-8 6Z"/><path d="M8 15 7.2 11l5-2.6 5 2 1 4-5 2.4Z"/></svg>',
  "narrow-neck":
    '<svg viewBox="0 0 24 24"><path d="M3 6h7l1 6h2l1-6h7v12h-7l-1-6h-2l-1 6H3Z"/><path d="M8 9h8"/></svg>',
  symmetric:
    '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4Z"/><path d="M8.5 8.5h7v7h-7Z"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
};

function clonePoints(points) {
  return points.map((point) => ({ x: point.x, y: point.y }));
}

function serializePoints(points) {
  return points
    .map((point) => `${Number(point.x.toFixed(3))}, ${Number(point.y.toFixed(3))}`)
    .join("\n");
}

function formatNumber(value, decimals = 1) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatArea(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 10000) return formatNumber(value, 0);
  if (value >= 100) return formatNumber(value, 1);
  return formatNumber(value, 2);
}

function formatTime(value) {
  return Number(value).toFixed(2);
}

function formatTolerance(value) {
  if (value >= 1e-4) return value.toExponential(1);
  return value.toExponential(0);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function createPresetButtons() {
  for (const preset of PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-button";
    button.dataset.preset = preset.id;
    button.innerHTML = `
      <span class="preset-icon">${PRESET_ICONS[preset.id] ?? ""}</span>
      <span class="preset-copy">
        <strong>${preset.label}</strong>
        <small>${preset.kicker}</small>
      </span>
      <span class="preset-arrow" aria-hidden="true">›</span>
    `;
    button.title = preset.description;
    button.addEventListener("click", () => loadPreset(preset));
    elements.presetGrid.append(button);
  }
}

function updatePresetSelection() {
  for (const button of elements.presetGrid.querySelectorAll(".preset-button")) {
    const active = button.dataset.preset === state.presetId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function loadPreset(preset) {
  state.presetId = preset.id;
  state.points = clonePoints(preset.points);
  state.distance = preset.targetDistance;
  state.currentEventIndex = -1;
  pausePlayback();
  elements.pointInput.value = serializePoints(state.points);
  updatePresetSelection();
  recompute({ keepDistance: true });
}

function parsePointInput() {
  const lines = elements.pointInput.value
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const points = [];
  for (let index = 0; index < lines.length; index += 1) {
    const values = lines[index].split(/[\s,;]+/).filter(Boolean);
    if (values.length !== 2) {
      throw new Error(`第 ${index + 1} 行需要两个坐标值。`);
    }
    const x = Number(values[0]);
    const y = Number(values[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`第 ${index + 1} 行包含无效数字。`);
    }
    points.push({ x, y });
  }
  if (points.length < 3) throw new Error("至少需要 3 个顶点。");
  return points;
}

function applyCustomPoints() {
  try {
    const points = parsePointInput();
    state.points = points;
    state.presetId = "custom";
    updatePresetSelection();
    pausePlayback();
    recompute({ keepDistance: true });
  } catch (error) {
    elements.inputError.textContent = error.message;
  }
}

function showInputError(message) {
  elements.inputError.textContent = message ?? "";
  elements.auditStatus.textContent = message ? "输入无效" : "区间检查 · 待运行";
  elements.auditStatus.classList.toggle("warn", Boolean(message));
}

function recompute({ keepDistance = true } = {}) {
  try {
    const result = computeStraightSkeleton(state.points, {
      tolerance: state.tolerance,
    });
    state.result = result;
    state.points = clonePoints(result.vertices);
    elements.pointInput.value = serializePoints(state.points);
    elements.vertexCount.textContent = `${state.points.length} 个顶点`;
    showInputError("");

    const terminal = Math.max(result.terminalTime, 1);
    const sliderMax = Math.max(5, terminal * 1.08);
    elements.distanceSlider.max = String(sliderMax);
    elements.distanceMaxLabel.textContent = formatNumber(sliderMax, 0);
    if (!keepDistance) state.distance = 0;
    state.distance = clamp(state.distance, 0, sliderMax);
    elements.toleranceInput.value = String(state.tolerance);
    elements.collinearRemoved.textContent = String(result.removedCollinear);
    elements.timeTolerance.textContent = result.stats.eventTimeTolerance.toExponential(
      0,
    );
    renderToleranceNote();
    renderAuditStatus();
    renderPresetMetadata();
    updateDistance(state.distance, { renderQueue: true, scroll: false });
  } catch (error) {
    showInputError(error.message);
    if (!state.result) {
      elements.eventList.innerHTML =
        '<div class="event-empty">修正输入后即可生成直骨架事件。</div>';
    }
  }
}

function scheduleRecompute() {
  if (state.recomputeFrame) return;
  state.recomputeFrame = requestAnimationFrame(() => {
    state.recomputeFrame = null;
    recompute({ keepDistance: true });
  });
}

function renderToleranceNote() {
  const tolerance = formatNumber(state.tolerance, state.tolerance < 0.001 ? 6 : 4);
  elements.toleranceNote.innerHTML = `
    <strong>τ = ${tolerance} u</strong>。相邻点距离 ≤ τ 去重；顶点到邻边垂距 ≤ τ
    视为共线并合并。事件合并窗为 0.001τ，接触参数容差为 τ/边长。
  `;
}

function renderAuditStatus() {
  const passed = state.result?.audit?.passed !== false;
  elements.auditStatus.textContent = passed ? "区间检查 · 通过" : "区间检查 · 发现自交";
  elements.auditStatus.classList.toggle("warn", !passed);
}

function renderPresetMetadata() {
  const preset = PRESETS.find((item) => item.id === state.presetId);
  elements.shapeTitle.textContent = preset?.label ?? "自定义多边形";
}

function buildPolygonPath(vertices) {
  if (!vertices.length) return "";
  return (
    vertices
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`,
      )
      .join(" ") + " Z"
  );
}

function updateViewBox() {
  const points = state.result?.vertices ?? state.points;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const padding = Math.max(34, span * 0.085);
  const x = minX - padding;
  const y = minY - padding;
  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;
  elements.scene.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  elements.gridRect.setAttribute("x", String(x));
  elements.gridRect.setAttribute("y", String(y));
  elements.gridRect.setAttribute("width", String(width));
  elements.gridRect.setAttribute("height", String(height));
  elements.worldGroup.setAttribute(
    "transform",
    `translate(0 ${(minY + maxY).toFixed(6)}) scale(1 -1)`,
  );
}

function renderScene(offset) {
  updateViewBox();
  const originalPath = buildPolygonPath(state.result.vertices);
  elements.originalLayer.innerHTML = `
    <path class="original-fill" d="${originalPath}"></path>
    <path class="original-outline" d="${originalPath}"></path>
  `;

  elements.offsetLayer.innerHTML = offset.components
    .map(
      (component, index) => `
        <path
          class="offset-shape component-${index % 5}"
          d="${buildPolygonPath(component.vertices)}"
        ></path>
      `,
    )
    .join("");

  elements.skeletonLayer.innerHTML = state.result.skeletonSegments
    .filter((segment) => segment.a && segment.b)
    .map((segment) => {
      const passed = segment.eventIndex <= state.currentEventIndex;
      return `
        <line
          class="skeleton-line ${passed ? "past" : "future"}"
          x1="${segment.a.x.toFixed(3)}"
          y1="${segment.a.y.toFixed(3)}"
          x2="${segment.b.x.toFixed(3)}"
          y2="${segment.b.y.toFixed(3)}"
        ></line>
      `;
    })
    .join("");

  const currentEvent = state.result.events[state.currentEventIndex];
  if (currentEvent) {
    const points = currentEvent.items.map((item) => item.point);
    elements.eventLayer.innerHTML = points
      .map(
        (point, index) => `
          <g transform="translate(${point.x.toFixed(3)} ${point.y.toFixed(3)})">
            <circle class="event-halo" r="13"></circle>
            <circle class="event-dot" r="4.5"></circle>
            <path class="event-cross" d="M-8 0H8M0 -8V8"></path>
            <g transform="scale(1 -1)">
              <text class="event-label" x="8" y="-8">#${currentEvent.id + 1}${String.fromCharCode(
                97 + index,
              )}</text>
            </g>
          </g>
        `,
      )
      .join("");
  } else {
    elements.eventLayer.innerHTML = "";
  }

  elements.handleLayer.innerHTML = state.result.vertices
    .map(
      (point, index) => `
        <circle
          class="vertex-handle"
          cx="${point.x.toFixed(3)}"
          cy="${point.y.toFixed(3)}"
          r="4"
          data-vertex-index="${index}"
        ></circle>
      `,
    )
    .join("");

  elements.distanceBadge.textContent = `d = ${formatNumber(offset.distance, 1)}`;
  elements.timeBadge.textContent = `t = ${formatNumber(offset.distance, 1)}`;
}

function renderMetrics(offset) {
  elements.componentMetric.textContent = String(offset.componentCount);
  elements.areaMetric.textContent = formatArea(offset.totalArea);
  elements.intersectionMetric.textContent = String(offset.selfIntersections);
  elements.intersectionMetric.classList.toggle("ok", offset.selfIntersections === 0);
  elements.intersectionMetric.classList.toggle("bad", offset.selfIntersections > 0);
  elements.eventMetric.textContent = `${Math.max(0, state.currentEventIndex + 1)} / ${
    state.result.events.length
  }`;

  if (!offset.components.length) {
    elements.componentStrip.innerHTML =
      '<div class="empty-component-card">轮廓已在当前距离完全消失，面积为 0。</div>';
    return;
  }
  elements.componentStrip.innerHTML = offset.components
    .map(
      (component, index) => `
        <article class="component-card component-${index % 5}">
          <div class="component-card-head">
            <strong>分量 ${String.fromCharCode(65 + index)}</strong>
            <span>${component.vertices.length} 边</span>
          </div>
          <div class="component-area">
            <b>${formatArea(component.area)}</b>
            <span>u²</span>
          </div>
          <div class="component-meta">
            周长 ${formatNumber(component.perimeter, 1)} u ·
            ${component.selfIntersections.length ? "自交" : "无自交"}
          </div>
        </article>
      `,
    )
    .join("");
}

function eventBadgeMarkup(event) {
  const splits = event.items.filter((item) => item.kind === "split").length;
  const collapses = event.items.length - splits;
  const badges = [];
  if (event.simultaneous > 1) {
    badges.push(`<span class="event-badge">同刻 ×${event.simultaneous}</span>`);
  }
  if (splits) {
    badges.push(`<span class="event-badge split">分裂 ×${splits}</span>`);
  }
  if (collapses) {
    badges.push(`<span class="event-badge collapse">边消失 ×${collapses}</span>`);
  }
  badges.push(
    `<span class="event-badge">${event.componentsBefore} → ${event.componentsAfter} 分量</span>`,
  );
  return badges.join("");
}

function renderEventList() {
  if (!state.result) return;
  const events = state.result.events;
  elements.queueCount.textContent = `${events.length} 组`;
  elements.splitCount.textContent = String(state.result.stats.splitCount);
  elements.collapseCount.textContent = String(state.result.stats.collapseCount);
  elements.maxSimultaneous.textContent = String(state.result.stats.maxSimultaneous);

  if (!events.length) {
    elements.eventList.innerHTML =
      '<div class="event-empty">没有拓扑事件。该形状可能在当前容差下退化，或轮廓尚未产生有效波前事件。</div>';
    return;
  }

  elements.eventList.innerHTML = events
    .map((event) => {
      const active = event.id === state.currentEventIndex;
      const past =
        event.time < state.distance - state.result.stats.eventTimeTolerance;
      const status = active ? "current" : past ? "past" : "future";
      const details = event.items
        .map((item) => `<p>${item.message}</p>`)
        .join("");
      return `
        <button
          type="button"
          class="event-card ${status}"
          data-event-index="${event.id}"
          aria-label="跳转到事件 ${event.id + 1}：${event.title}"
        >
          <span class="event-index">#${String(event.id + 1).padStart(2, "0")}</span>
          <span class="event-body">
            <span class="event-title-row">
              <strong>${event.title}</strong>
              <span class="event-time">t=${formatTime(event.time)}</span>
            </span>
            <span class="event-badges">${eventBadgeMarkup(event)}</span>
            <span class="event-detail">
              ${details}
              <p>面积 <b>${formatArea(event.areaBefore)}</b> → <b>${formatArea(
                event.areaAfter,
              )}</b> · 事件点 <b>${formatNumber(event.point.x, 1)}, ${formatNumber(
                event.point.y,
                1,
              )}</b></p>
            </span>
          </span>
        </button>
      `;
    })
    .join("");
}

function updateQueueProgress() {
  const terminal = state.result?.terminalTime ?? 0;
  const progress =
    terminal > 0 ? clamp(state.distance / terminal, 0, 1) * 100 : 0;
  elements.queueProgressFill.style.width = `${progress}%`;
  elements.queueTime.textContent = `t = ${formatTime(state.distance)}`;
  const events = state.result?.events ?? [];
  if (!events.length) {
    elements.queueStatus.textContent = "无拓扑事件";
    return;
  }
  const current = events[state.currentEventIndex];
  const tolerance = state.result.stats.eventTimeTolerance;
  if (current && Math.abs(state.distance - current.time) <= tolerance * 10) {
    elements.queueStatus.textContent = `已到达事件 #${current.id + 1}`;
  } else if (current) {
    elements.queueStatus.textContent = `已越过事件 #${current.id + 1}`;
  } else {
    elements.queueStatus.textContent = "等待首个事件";
  }
}

function updateDistance(value, options = {}) {
  if (!state.result) return;
  const max = Number(elements.distanceSlider.max) || state.result.terminalTime;
  state.distance = clamp(Number(value) || 0, 0, max);
  const offset = getOffsetAt(state.result, state.distance);
  let currentIndex = -1;
  for (const event of state.result.events) {
    if (event.time <= state.distance + state.result.stats.eventTimeTolerance) {
      currentIndex = event.id;
    } else {
      break;
    }
  }
  const changed = currentIndex !== state.currentEventIndex;
  state.currentEventIndex = currentIndex;

  if (options.syncDistanceInput !== false) {
    elements.distanceInput.value = Number(state.distance.toFixed(2));
  }
  elements.distanceSlider.value = String(state.distance);
  const sliderMax = Number(elements.distanceSlider.max) || 1;
  elements.distanceSlider.style.setProperty(
    "--range-progress",
    `${(state.distance / sliderMax) * 100}%`,
  );
  renderScene(offset);
  renderMetrics(offset);
  updateQueueProgress();
  if (changed || options.renderQueue) renderEventList();
  if (options.scroll && changed) {
    const currentCard = elements.eventList.querySelector(".event-card.current");
    currentCard?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function updatePlayButton() {
  elements.playButton.classList.toggle("playing", state.playing);
  elements.playLabel.textContent = state.playing ? "暂停" : "播放";
  elements.playButton.setAttribute(
    "aria-label",
    state.playing ? "暂停内缩播放" : "播放内缩过程",
  );
}

function pausePlayback() {
  state.playing = false;
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  updatePlayButton();
}

function playbackSpeed() {
  const terminal = Math.max(1, state.result?.terminalTime ?? 1);
  return Math.max(8, terminal / 9);
}

function animationTick(timestamp) {
  if (!state.playing || !state.result) return;
  const elapsed = Math.min(0.05, Math.max(0, (timestamp - state.lastFrameTime) / 1000));
  state.lastFrameTime = timestamp;
  const nextDistance = state.distance + playbackSpeed() * elapsed;
  const tolerance = state.result.stats.eventTimeTolerance;
  const nextEvent = state.result.events.find(
    (event) => event.time > state.distance + tolerance,
  );

  if (
    elements.stopAtEvents.checked &&
    nextEvent &&
    nextDistance >= nextEvent.time
  ) {
    updateDistance(nextEvent.time, { scroll: true });
    pausePlayback();
    return;
  }

  const sliderMax = Number(elements.distanceSlider.max);
  if (nextDistance >= sliderMax) {
    updateDistance(sliderMax, { scroll: false });
    pausePlayback();
    return;
  }

  updateDistance(nextDistance, { scroll: false });
  state.animationFrame = requestAnimationFrame(animationTick);
}

function startPlayback() {
  if (!state.result) return;
  if (!state.result.events.length && state.result.terminalTime <= 0) return;
  const sliderMax = Number(elements.distanceSlider.max);
  if (state.distance >= sliderMax - 1e-7) updateDistance(0);
  state.playing = true;
  state.lastFrameTime = performance.now();
  updatePlayButton();
  state.animationFrame = requestAnimationFrame(animationTick);
}

function togglePlayback() {
  if (state.playing) {
    pausePlayback();
  } else {
    startPlayback();
  }
}

function stepEvent(direction) {
  if (!state.result?.events.length) return;
  pausePlayback();
  const tolerance = state.result.stats.eventTimeTolerance;
  if (direction > 0) {
    const next = state.result.events.find(
      (event) => event.time > state.distance + tolerance,
    );
    updateDistance(next ? next.time : Number(elements.distanceSlider.max), {
      scroll: true,
    });
  } else {
    const previous = [...state.result.events]
      .reverse()
      .find((event) => event.time < state.distance - tolerance);
    updateDistance(previous ? previous.time : 0, { scroll: true });
  }
}

function updateTolerance() {
  const value = Number(elements.toleranceInput.value);
  if (!Number.isFinite(value)) {
    showInputError("容差必须是有效数字。");
    return;
  }
  state.tolerance = clamp(value, MIN_TOLERANCE, MAX_TOLERANCE);
  elements.toleranceInput.value = String(state.tolerance);
  pausePlayback();
  recompute({ keepDistance: true });
}

function clientToWorld(clientX, clientY) {
  const matrix = elements.worldGroup.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

function handlePointerDown(event) {
  const handle = event.target.closest?.("[data-vertex-index]");
  if (!handle) return;
  event.preventDefault();
  pausePlayback();
  state.dragIndex = Number(handle.dataset.vertexIndex);
  state.dragMoved = true;
  handle.classList.add("dragging");
  elements.scene.setPointerCapture?.(event.pointerId);
  elements.canvasHint.textContent = "拖动中 · 松开后重新计算事件队列";
}

function handlePointerMove(event) {
  if (state.dragIndex === null) return;
  const point = clientToWorld(event.clientX, event.clientY);
  if (!point) return;
  state.points[state.dragIndex] = {
    x: Math.round(point.x * 10) / 10,
    y: Math.round(point.y * 10) / 10,
  };
  state.presetId = "custom";
  updatePresetSelection();
  scheduleRecompute();
}

function handlePointerUp(event) {
  if (state.dragIndex === null) return;
  state.dragIndex = null;
  elements.scene.releasePointerCapture?.(event.pointerId);
  elements.canvasHint.textContent = "拖动顶点可直接编辑形状";
  if (state.recomputeFrame) {
    cancelAnimationFrame(state.recomputeFrame);
    state.recomputeFrame = null;
  }
  recompute({ keepDistance: true });
}

function bindEvents() {
  elements.applyPoints.addEventListener("click", applyCustomPoints);
  elements.pointInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      applyCustomPoints();
    }
  });

  elements.distanceSlider.addEventListener("input", () => {
    pausePlayback();
    updateDistance(elements.distanceSlider.value);
  });
  elements.distanceInput.addEventListener("input", () => {
    pausePlayback();
    updateDistance(elements.distanceInput.value, { syncDistanceInput: false });
  });

  elements.playButton.addEventListener("click", togglePlayback);
  elements.prevEvent.addEventListener("click", () => stepEvent(-1));
  elements.nextEvent.addEventListener("click", () => stepEvent(1));
  elements.resetPlayback.addEventListener("click", () => {
    pausePlayback();
    updateDistance(0, { scroll: true });
  });
  elements.toleranceInput.addEventListener("change", updateTolerance);

  elements.eventList.addEventListener("click", (event) => {
    const card = event.target.closest?.("[data-event-index]");
    if (!card || !state.result) return;
    const index = Number(card.dataset.eventIndex);
    const selected = state.result.events[index];
    if (!selected) return;
    pausePlayback();
    updateDistance(selected.time, { scroll: true });
  });

  elements.scene.addEventListener("pointerdown", handlePointerDown);
  elements.scene.addEventListener("pointermove", handlePointerMove);
  elements.scene.addEventListener("pointerup", handlePointerUp);
  elements.scene.addEventListener("pointercancel", handlePointerUp);

  document.addEventListener("keydown", (event) => {
    const tag = event.target.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "summary") return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      stepEvent(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepEvent(-1);
    }
  });
}

function initialize() {
  createPresetButtons();
  bindEvents();
  elements.pointInput.value = serializePoints(state.points);
  elements.toleranceInput.value = String(state.tolerance);
  elements.stopAtEvents.checked = true;
  updatePresetSelection();
  updatePlayButton();
  recompute({ keepDistance: true });
}

initialize();
