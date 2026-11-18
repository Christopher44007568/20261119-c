import {
  fromFixed,
  rasterizeScene,
  snapToSubpixel,
  evaluatePixel,
  toFixed,
  SUBPIXEL_SCALE,
} from "./rasterizer.js";
import {
  collinearPoint,
  runVerification,
  sharedEdgePixels,
} from "./verification.js";

const WIDTH = 64;
const HEIGHT = 46;
const CELL = 12;
const FRAME_WIDTH = WIDTH * CELL;
const FRAME_HEIGHT = HEIGHT * CELL;
const HANDLE_RADIUS = 10;
const HANDLE_HIT_RADIUS = 15;
const HANDLE_MARGIN = HANDLE_RADIUS / CELL;

const DEFAULT_GEOMETRY = {
  a: { x: 15, y: 17 },
  b: { x: 49, y: 31 },
  c: { x: 22, y: 38 },
  d: { x: 45, y: 12 },
};

const DEFAULT_T1_ORDER = ["a", "c", "b"];
const DEFAULT_T2_ORDER = ["b", "d", "a"];
const DEFAULT_PIXEL = { x: 23, y: 20 };

const TRIANGLE_COLORS = {
  a: "#2ad2eb",
  b: "#ffa448",
};

const HANDLES = {
  a: { label: "A", shared: true },
  b: { label: "B", shared: true },
  c: { label: "C", shared: false, color: TRIANGLE_COLORS.a },
  d: { label: "D", shared: false, color: TRIANGLE_COLORS.b },
};

const dom = {
  canvas: document.getElementById("viewportCanvas"),
  viewTabs: document.getElementById("viewTabs"),
  legend: document.getElementById("legend"),
  warning: document.getElementById("geometryWarning"),
  statCovered: document.getElementById("statCovered"),
  statShared: document.getElementById("statShared"),
  statMaxCoverage: document.getElementById("statMaxCoverage"),
  statOverdraw: document.getElementById("statOverdraw"),
  pixelCoord: document.getElementById("pixelCoord"),
  fixedCoord: document.getElementById("fixedCoord"),
  coverageChip: document.getElementById("coverageChip"),
  triangleTabs: document.getElementById("triangleTabs"),
  edgeList: document.getElementById("edgeList"),
  pixelVerdict: document.getElementById("pixelVerdict"),
  subpixelState: document.getElementById("subpixelState"),
  centerNudge: document.getElementById("centerNudge"),
  orderT1: document.getElementById("orderT1"),
  orderT2: document.getElementById("orderT2"),
  degenerateBtn: document.getElementById("degenerateBtn"),
  resetBtn: document.getElementById("resetBtn"),
  verificationList: document.getElementById("verificationList"),
  verifyBadge: document.getElementById("verifyBadge"),
  verifySummary: document.getElementById("verifySummary"),
  rerunBtn: document.getElementById("rerunBtn"),
  frameTime: document.getElementById("frameTime"),
  overlayToggles: document.querySelectorAll("[data-overlay]"),
};

const state = {
  geometry: cloneGeometry(DEFAULT_GEOMETRY),
  t1Order: [...DEFAULT_T1_ORDER],
  t2Order: [...DEFAULT_T2_ORDER],
  view: "color",
  activeTriangle: "a",
  activeEdge: 0,
  selectedPixel: { ...DEFAULT_PIXEL },
  hoverPixel: null,
  dragging: null,
  overlays: { grid: true, wire: true, samples: true },
  nudge: { x: 0, y: 0 },
  degenerate: false,
  savedC: null,
  scene: null,
  verificationTimer: null,
  verificationFrame: 0,
};

const context = dom.canvas.getContext("2d", { alpha: false });
const framebufferCanvas = document.createElement("canvas");
framebufferCanvas.width = WIDTH;
framebufferCanvas.height = HEIGHT;
const framebufferContext = framebufferCanvas.getContext("2d", {
  alpha: false,
  willReadFrequently: false,
});
const framebufferImage = framebufferContext.createImageData(WIDTH, HEIGHT);
let canvasScale = 0;

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function cloneGeometry(geometry) {
  return Object.fromEntries(
    Object.entries(geometry).map(([key, point]) => [key, clonePoint(point)]),
  );
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function effectiveGeometry() {
  const geometry = cloneGeometry(state.geometry);
  if (state.degenerate) {
    geometry.c = collinearPoint(geometry.a, geometry.b, 0.625);
  }
  return geometry;
}

function trianglePoints(geometry, order) {
  return order.map((key) => geometry[key]);
}

function activePixel() {
  return state.hoverPixel || state.selectedPixel;
}

function pointToScreen(point) {
  return { x: point.x * CELL, y: point.y * CELL };
}

function screenToPixel(x, y) {
  return {
    x: clamp(Math.floor(x / CELL), 0, WIDTH - 1),
    y: clamp(Math.floor(y / CELL), 0, HEIGHT - 1),
  };
}

function fixedLabel(value) {
  if (value > 0) return `+${value}`;
  return String(value);
}

function padPixels(value) {
  return String(value).padStart(3, "0");
}

function edgeLabelsForOrder(order) {
  const upper = order.map((key) => key.toUpperCase());
  return [
    `${upper[0]}${upper[1]}`,
    `${upper[1]}${upper[2]}`,
    `${upper[2]}${upper[0]}`,
  ];
}

function setupCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
  if (ratio === canvasScale) return;

  canvasScale = ratio;
  dom.canvas.width = Math.round(FRAME_WIDTH * ratio);
  dom.canvas.height = Math.round(FRAME_HEIGHT * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.imageSmoothingEnabled = false;
}

function mixColor(from, to, amount) {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}

function writePixel(buffer, index, rgb) {
  const offset = index * 4;
  buffer[offset] = rgb[0];
  buffer[offset + 1] = rgb[1];
  buffer[offset + 2] = rgb[2];
  buffer[offset + 3] = 255;
}

function paintEdgeView(buffer) {
  const result =
    state.activeTriangle === "a" ? state.scene.resultA : state.scene.resultB;
  const prepared = result.prepared;
  const background = [8, 12, 18];
  const positive = [42, 210, 235];
  const negative = [68, 72, 148];
  const zero = [247, 212, 107];
  const scale = Math.max(1, prepared.area / 2);

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = y * WIDTH + x;
      if (prepared.degenerate) {
        writePixel(buffer, index, background);
        continue;
      }

      const sample = evaluatePixel(prepared, x, y);
      const value = sample.edges[state.activeEdge].value;
      if (value === 0) {
        writePixel(buffer, index, zero);
        continue;
      }

      const strength = Math.pow(Math.min(1, Math.abs(value) / scale), 0.62);
      const color = value > 0
        ? mixColor(background, positive, strength * 0.9)
        : mixColor(background, negative, strength * 0.82);
      writePixel(buffer, index, color);
    }
  }
}

function paintView() {
  const buffer = framebufferImage.data;

  if (state.view === "color") {
    buffer.set(state.scene.colorBuffer);
  } else if (state.view === "mask") {
    for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
      const inA = state.scene.resultA.coverage[index] === 1;
      const inB = state.scene.resultB.coverage[index] === 1;
      let color = (index + Math.floor(index / WIDTH)) % 2 === 0
        ? [8, 12, 18]
        : [12, 18, 27];
      if (inA && inB) color = [255, 75, 118];
      else if (inA) color = [42, 210, 235];
      else if (inB) color = [255, 164, 72];
      writePixel(buffer, index, color);
    }
  } else if (state.view === "count") {
    const countColors = [
      [9, 14, 21],
      [31, 190, 157],
      [255, 75, 118],
    ];
    for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
      writePixel(buffer, index, countColors[state.scene.coverageCount[index]]);
    }
  } else {
    paintEdgeView(buffer);
  }

  framebufferContext.putImageData(framebufferImage, 0, 0);
}

function drawGrid() {
  context.save();
  context.beginPath();
  for (let x = 0; x <= WIDTH; x += 1) {
    const position = x * CELL + 0.5;
    context.moveTo(position, 0);
    context.lineTo(position, FRAME_HEIGHT);
  }
  for (let y = 0; y <= HEIGHT; y += 1) {
    const position = y * CELL + 0.5;
    context.moveTo(0, position);
    context.lineTo(FRAME_WIDTH, position);
  }
  context.strokeStyle = "rgba(218, 239, 247, 0.075)";
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

function drawSharedSamples(geometry) {
  const samples = sharedEdgePixels(geometry, WIDTH, HEIGHT);
  context.save();
  samples.forEach(({ x, y }) => {
    const centerX = (x + 0.5) * CELL;
    const centerY = (y + 0.5) * CELL;
    context.beginPath();
    context.arc(centerX, centerY, 3.2, 0, Math.PI * 2);
    context.fillStyle = "rgba(247, 212, 107, 0.85)";
    context.fill();
    context.beginPath();
    context.arc(centerX, centerY, 5.2, 0, Math.PI * 2);
    context.strokeStyle = "rgba(247, 212, 107, 0.35)";
    context.lineWidth = 1;
    context.stroke();
  });
  context.restore();
}

function drawPixelFocus() {
  const selected = state.selectedPixel;
  const hovered = state.hoverPixel;

  context.save();
  if (hovered) {
    context.fillStyle = "rgba(255, 255, 255, 0.09)";
    context.fillRect(
      hovered.x * CELL + 1,
      hovered.y * CELL + 1,
      CELL - 2,
      CELL - 2,
    );
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    context.lineWidth = 1.5;
    context.strokeRect(
      hovered.x * CELL + 0.75,
      hovered.y * CELL + 0.75,
      CELL - 1.5,
      CELL - 1.5,
    );
  }

  if (!hovered || selected.x !== hovered.x || selected.y !== hovered.y) {
    context.setLineDash([3, 2]);
    context.strokeStyle = "rgba(247, 212, 107, 0.85)";
    context.lineWidth = 1.2;
    context.strokeRect(
      selected.x * CELL + 1.25,
      selected.y * CELL + 1.25,
      CELL - 2.5,
      CELL - 2.5,
    );
  }

  const px = (selected.x + 0.5) * CELL;
  const py = (selected.y + 0.5) * CELL;
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(px - 2.5, py);
  context.lineTo(px + 2.5, py);
  context.moveTo(px, py - 2.5);
  context.lineTo(px, py + 2.5);
  context.strokeStyle = "rgba(6, 12, 18, 0.8)";
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

function tracePolygon(points) {
  context.beginPath();
  points.forEach((point, index) => {
    const screen = pointToScreen(point);
    if (index === 0) context.moveTo(screen.x, screen.y);
    else context.lineTo(screen.x, screen.y);
  });
  context.closePath();
}

function drawWireframe(geometry) {
  const triangleA = trianglePoints(geometry, state.t1Order);
  const triangleB = trianglePoints(geometry, state.t2Order);

  context.save();
  context.lineJoin = "round";

  [
    { points: triangleA, color: TRIANGLE_COLORS.a, active: state.activeTriangle === "a" },
    { points: triangleB, color: TRIANGLE_COLORS.b, active: state.activeTriangle === "b" },
  ].forEach(({ points, color, active }) => {
    tracePolygon(points);
    context.strokeStyle = color;
    context.globalAlpha = active ? 0.92 : 0.48;
    context.lineWidth = active ? 1.8 : 1.1;
    context.stroke();
  });

  context.globalAlpha = 1;
  context.beginPath();
  context.moveTo(geometry.a.x * CELL, geometry.a.y * CELL);
  context.lineTo(geometry.b.x * CELL, geometry.b.y * CELL);
  context.setLineDash([5, 4]);
  context.strokeStyle = "rgba(240, 248, 251, 0.78)";
  context.lineWidth = 1;
  context.stroke();
  context.setLineDash([]);

  if (state.view === "edge") {
    const result =
      state.activeTriangle === "a" ? state.scene.resultA : state.scene.resultB;
    const edge = result.prepared.edges[state.activeEdge];
    context.beginPath();
    context.moveTo(fromFixed(edge.ax) * CELL, fromFixed(edge.ay) * CELL);
    context.lineTo(fromFixed(edge.bx) * CELL, fromFixed(edge.by) * CELL);
    context.strokeStyle = "rgba(247, 212, 107, 0.95)";
    context.lineWidth = 2.4;
    context.stroke();
  }

  context.restore();
}

function drawSharedEdgeArrow(geometry) {
  const a = pointToScreen(geometry.a);
  const b = pointToScreen(geometry.b);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  context.save();
  context.translate(midpoint.x, midpoint.y);
  context.rotate(angle);
  context.beginPath();
  context.moveTo(-4, -3.5);
  context.lineTo(3, 0);
  context.lineTo(-4, 3.5);
  context.strokeStyle = "rgba(247, 212, 107, 0.82)";
  context.lineWidth = 1.2;
  context.stroke();
  context.restore();
}

function drawHandle(point, key, dragging) {
  const screen = pointToScreen(point);
  const meta = HANDLES[key];
  const radius = dragging ? HANDLE_RADIUS + 2 : HANDLE_RADIUS;

  context.save();
  if (dragging) {
    context.shadowColor = meta.shared ? "#ffffff" : meta.color;
    context.shadowBlur = 18;
  }

  context.beginPath();
  context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 11, 17, 0.9)";
  context.fill();

  context.beginPath();
  context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  context.strokeStyle = meta.shared ? "#eaf2f5" : meta.color;
  context.lineWidth = dragging ? 2.4 : 1.6;
  context.stroke();

  if (meta.shared) {
    context.beginPath();
    context.arc(screen.x, screen.y, radius - 3.2, -Math.PI * 0.9, Math.PI * 0.1);
    context.strokeStyle = TRIANGLE_COLORS.a;
    context.lineWidth = 1.8;
    context.stroke();
    context.beginPath();
    context.arc(screen.x, screen.y, radius - 3.2, Math.PI * 0.1, Math.PI * 1.1);
    context.strokeStyle = TRIANGLE_COLORS.b;
    context.lineWidth = 1.8;
    context.stroke();
  }

  context.fillStyle = "#f3f8fa";
  context.font = '700 9px "SFMono-Regular", "Cascadia Code", monospace';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(meta.label, screen.x, screen.y + 0.5);
  context.restore();
}

function drawHandles(geometry) {
  Object.keys(HANDLES).forEach((key) => {
    drawHandle(
      geometry[key],
      key,
      state.dragging === key,
    );
  });
}

function drawEdgeViewTag() {
  if (state.view !== "edge") return;
  const result =
    state.activeTriangle === "a" ? state.scene.resultA : state.scene.resultB;
  const edge = result.prepared.edges[state.activeEdge];
  const text = `TRI ${state.activeTriangle.toUpperCase()} · E${state.activeEdge} ${edge.label}`;

  context.save();
  context.font = '700 9px "SFMono-Regular", "Cascadia Code", monospace';
  const metrics = context.measureText(text);
  const width = metrics.width + 16;
  const x = FRAME_WIDTH - width - 11;
  context.fillStyle = "rgba(4, 9, 14, 0.78)";
  context.fillRect(x, 10, width, 23);
  context.strokeStyle = "rgba(247, 212, 107, 0.25)";
  context.strokeRect(x + 0.5, 10.5, width - 1, 22);
  context.fillStyle = "#f7d46b";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x + width / 2, 21.5);
  context.restore();
}

function drawCanvas(geometry) {
  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(framebufferCanvas, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  context.restore();

  if (state.overlays.grid) drawGrid();
  if (state.overlays.samples) drawSharedSamples(geometry);
  drawPixelFocus();
  if (state.overlays.wire) {
    drawWireframe(geometry);
    drawSharedEdgeArrow(geometry);
  }
  drawHandles(geometry);
  drawEdgeViewTag();
}

function sharedEdgeStatus(geometry) {
  const samples = sharedEdgePixels(geometry, WIDTH, HEIGHT);
  let once = 0;
  let gaps = 0;
  let duplicates = 0;

  samples.forEach(({ x, y }) => {
    const count = state.scene.coverageCount[y * WIDTH + x];
    if (count === 0) gaps += 1;
    else if (count > 1) duplicates += 1;
    else once += 1;
  });

  return { samples, once, gaps, duplicates };
}

function updateStats(geometry) {
  const scene = state.scene;
  const shared = sharedEdgeStatus(geometry);
  let maxCoverage = 0;
  for (const count of scene.coverageCount) {
    if (count > maxCoverage) maxCoverage = count;
  }

  dom.statCovered.textContent =
    `${padPixels(scene.resultA.pixelCount)} / ${padPixels(scene.resultB.pixelCount)}`;
  dom.statShared.textContent = shared.samples.length
    ? `${shared.once}/${shared.samples.length}`
    : "—";
  dom.statMaxCoverage.textContent = String(maxCoverage);
  dom.statOverdraw.textContent = String(scene.overdrawPixels);

  const warnings = [];
  if (scene.resultA.prepared.degenerate) warnings.push("T1 面积 = 0");
  if (scene.resultB.prepared.degenerate) warnings.push("T2 面积 = 0");
  if (shared.gaps > 0) warnings.push(`共享边漏填 ${shared.gaps} px`);
  if (shared.duplicates > 0) warnings.push(`共享边重复 ${shared.duplicates} px`);
  if (scene.overdrawPixels > 0) {
    warnings.push(`场景重绘 ${scene.overdrawPixels} px`);
  }

  dom.warning.hidden = warnings.length === 0;
  dom.warning.textContent = warnings.join(" · ");
}

function updateInspector() {
  const pixel = activePixel();
  const sampleA = evaluatePixel(state.scene.resultA.prepared, pixel.x, pixel.y);
  const sampleB = evaluatePixel(state.scene.resultB.prepared, pixel.x, pixel.y);
  const sample = state.activeTriangle === "a" ? sampleA : sampleB;
  const result =
    state.activeTriangle === "a" ? state.scene.resultA : state.scene.resultB;
  const count = state.scene.coverageCount[pixel.y * WIDTH + pixel.x];
  const centerX = pixel.x * SUBPIXEL_SCALE + SUBPIXEL_SCALE / 2;
  const centerY = pixel.y * SUBPIXEL_SCALE + SUBPIXEL_SCALE / 2;

  dom.pixelCoord.textContent = `(${pixel.x}, ${pixel.y})`;
  dom.fixedCoord.textContent =
    `center = (${centerX}, ${centerY}), Q28.4`;
  dom.coverageChip.textContent = `COUNT ${count}`;
  dom.coverageChip.classList.toggle("is-zero", count === 0);
  dom.coverageChip.classList.toggle("is-over", count > 1);

  dom.edgeList.innerHTML = sample.edges
    .map((edge, index) => {
      const valueClass = edge.value === 0
        ? "is-zero"
        : edge.value < 0
          ? "is-negative"
          : "";
      const accepted = result.prepared.degenerate
        ? "—"
        : edge.accepted
          ? "✓"
          : "×";
      return `
        <button class="edge-row${index === state.activeEdge ? " is-active" : ""}"
          data-edge="${index}" aria-pressed="${index === state.activeEdge}">
          <span class="edge-name"><b>E${index}</b>${edge.label}</span>
          <span class="edge-value ${valueClass}">${fixedLabel(edge.value)}</span>
          <span class="tl-badge${edge.topLeft ? " is-on" : ""}">TL</span>
          <span class="accept-mark${edge.accepted ? "" : " is-out"}">${accepted}</span>
        </button>
      `;
    })
    .join("");

  const inA = sampleA.inside;
  const inB = sampleB.inside;
  let verdictClass = "";
  let verdictText =
    `T1 ${inA ? "IN" : "OUT"} · T2 ${inB ? "IN" : "OUT"} · 写入 ${count} 次`;

  if (result.prepared.degenerate) {
    verdictClass = " is-error";
    verdictText = `TRI ${state.activeTriangle.toUpperCase()} 退化：面积 0，不产生片元`;
  } else if (count > 1) {
    verdictClass = " is-error";
    verdictText = "OVERDRAW：该像素被两个三角形同时覆盖";
  } else if (count === 0) {
    verdictClass = " is-outside";
    verdictText = `背景像素 · T1 ${inA ? "IN" : "OUT"} · T2 ${inB ? "IN" : "OUT"}`;
  }

  dom.pixelVerdict.className = `pixel-verdict${verdictClass}`;
  dom.pixelVerdict.textContent = verdictText;

  dom.triangleTabs.querySelectorAll("[data-triangle]").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.triangle === state.activeTriangle,
    );
  });
}

function updateLegend() {
  const activeLabel = state.activeTriangle.toUpperCase();
  const result =
    state.activeTriangle === "a" ? state.scene.resultA : state.scene.resultB;
  const edge = result.prepared.edges[state.activeEdge];

  if (state.view === "count") {
    dom.legend.innerHTML = `
      <span class="legend-item"><i class="legend-swatch" style="background:#090e15"></i>0 次</span>
      <span class="legend-item"><i class="legend-swatch" style="background:#1fbe9d"></i>1 次</span>
      <span class="legend-item"><i class="legend-swatch" style="background:#ff4b76"></i>2 次</span>
    `;
  } else if (state.view === "edge") {
    dom.legend.innerHTML = `
      <span class="legend-item"><i class="legend-gradient"></i>负值 → 0 → 正值</span>
      <span class="legend-item">TRI ${activeLabel} / E${state.activeEdge} ${edge.label}</span>
    `;
  } else {
    dom.legend.innerHTML = `
      <span class="legend-item"><i class="legend-swatch" style="background:#2ad2eb"></i>T1 覆盖</span>
      <span class="legend-item"><i class="legend-swatch" style="background:#ffa448"></i>T2 覆盖</span>
      <span class="legend-item"><i class="legend-swatch" style="background:#ff4b76"></i>重复覆盖</span>
    `;
  }
}

function signedSteps(value) {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : `${value}`;
}

function updateControls() {
  dom.orderT1.innerHTML =
    `<b>T1</b>${state.t1Order.map((key) => key.toUpperCase()).join(" → ")}`;
  dom.orderT2.innerHTML =
    `<b>T2</b>${state.t2Order.map((key) => key.toUpperCase()).join(" → ")}`;
  dom.subpixelState.textContent =
    `ΔX ${signedSteps(state.nudge.x)}/16 · ΔY ${signedSteps(state.nudge.y)}/16`;

  dom.degenerateBtn.classList.toggle("is-active", state.degenerate);
  dom.degenerateBtn.textContent = state.degenerate ? "恢复 T1" : "退化 T1";

  dom.viewTabs.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
  dom.overlayToggles.forEach((button) => {
    const enabled = state.overlays[button.dataset.overlay];
    button.classList.toggle("is-on", enabled);
    button.setAttribute("aria-pressed", String(enabled));
  });
}

function renderScene() {
  const start = performance.now();
  setupCanvas();
  const geometry = effectiveGeometry();
  const labelsA = edgeLabelsForOrder(state.t1Order);
  const labelsB = edgeLabelsForOrder(state.t2Order);
  state.scene = rasterizeScene(
    trianglePoints(geometry, state.t1Order),
    trianglePoints(geometry, state.t2Order),
    WIDTH,
    HEIGHT,
    labelsA,
    labelsB,
  );
  state.geometry = geometry;

  paintView();
  drawCanvas(geometry);
  updateStats(geometry);
  updateInspector();
  updateLegend();
  updateControls();
  dom.frameTime.textContent = `${(performance.now() - start).toFixed(2)} ms / frame`;
}

function setVerificationRunning() {
  dom.verifyBadge.textContent = "RUN";
  dom.verifyBadge.className = "pass-badge is-running";
  dom.verifySummary.textContent = "正在验证当前几何…";
}

function renderVerification(result, elapsed) {
  dom.verifyBadge.textContent = result.ok ? "PASS" : "FAIL";
  dom.verifyBadge.className = `pass-badge${result.ok ? "" : " is-fail"}`;
  dom.verificationList.innerHTML = result.groups
    .map(
      (group) => `
        <div class="verify-row${group.status === "pass" ? "" : " is-fail"}">
          <div>
            <div class="verify-main">
              <strong>${group.label}</strong>
              <span>${group.status.toUpperCase()}</span>
            </div>
            <div class="verify-detail">${group.detail}</div>
          </div>
        </div>
      `,
    )
    .join("");

  const passed = result.groups.filter((group) => group.status === "pass").length;
  dom.verifySummary.textContent =
    `${passed}/${result.groups.length} 组通过 · ${elapsed.toFixed(1)} ms`;
}

function runVerificationNow() {
  window.clearTimeout(state.verificationTimer);
  state.verificationTimer = null;
  setVerificationRunning();
  const frame = state.verificationFrame + 1;
  state.verificationFrame = frame;

  window.requestAnimationFrame(() => {
    if (frame !== state.verificationFrame) return;
    const start = performance.now();
    const result = runVerification(effectiveGeometry(), WIDTH, HEIGHT);
    if (frame !== state.verificationFrame) return;
    renderVerification(result, performance.now() - start);
  });
}

function scheduleVerification(delay = 140) {
  window.clearTimeout(state.verificationTimer);
  setVerificationRunning();
  state.verificationTimer = window.setTimeout(runVerificationNow, delay);
}

function pointerPosition(event) {
  const bounds = dom.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * (FRAME_WIDTH / bounds.width),
    y: (event.clientY - bounds.top) * (FRAME_HEIGHT / bounds.height),
  };
}

function findHandle(position) {
  let nearest = null;
  let nearestDistance = HANDLE_HIT_RADIUS;
  const geometry = effectiveGeometry();

  Object.entries(geometry).forEach(([key, point]) => {
    const screen = pointToScreen(point);
    const distance = Math.hypot(screen.x - position.x, screen.y - position.y);
    if (distance <= nearestDistance) {
      nearest = key;
      nearestDistance = distance;
    }
  });

  return nearest;
}

function moveHandle(key, position) {
  const x = snapToSubpixel(
    clamp(position.x / CELL, HANDLE_MARGIN, WIDTH - HANDLE_MARGIN),
  );
  const y = snapToSubpixel(
    clamp(position.y / CELL, HANDLE_MARGIN, HEIGHT - HANDLE_MARGIN),
  );
  state.geometry[key] = { x, y };
  state.nudge = { x: 0, y: 0 };
  state.hoverPixel = screenToPixel(position.x, position.y);
}

function startDrag(key, event) {
  if (state.degenerate && key === "c") {
    state.degenerate = false;
    state.savedC = null;
  }

  state.dragging = key;
  dom.canvas.setPointerCapture(event.pointerId);
  moveHandle(key, pointerPosition(event));
  renderScene();
  scheduleVerification();
}

function endDrag(event) {
  if (!state.dragging) return;
  state.dragging = null;
  if (dom.canvas.hasPointerCapture(event.pointerId)) {
    dom.canvas.releasePointerCapture(event.pointerId);
  }
  renderScene();
  scheduleVerification(30);
}

function nudgeGeometry(deltaX, deltaY) {
  const shifted = Object.values(state.geometry).map((point) => ({
    x: fromFixed(toFixed(point.x) + deltaX),
    y: fromFixed(toFixed(point.y) + deltaY),
  }));
  const inBounds = shifted.every(
    (point) =>
      point.x >= HANDLE_MARGIN &&
      point.x <= WIDTH - HANDLE_MARGIN &&
      point.y >= HANDLE_MARGIN &&
      point.y <= HEIGHT - HANDLE_MARGIN,
  );
  if (!inBounds) return;

  Object.keys(state.geometry).forEach((key) => {
    const point = state.geometry[key];
    state.geometry[key] = {
      x: fromFixed(toFixed(point.x) + deltaX),
      y: fromFixed(toFixed(point.y) + deltaY),
    };
  });
  if (state.savedC) {
    state.savedC = {
      x: fromFixed(toFixed(state.savedC.x) + deltaX),
      y: fromFixed(toFixed(state.savedC.y) + deltaY),
    };
  }
  state.nudge.x += deltaX;
  state.nudge.y += deltaY;
  renderScene();
  scheduleVerification();
}

function resetNudge() {
  if (state.nudge.x === 0 && state.nudge.y === 0) return;
  nudgeGeometry(-state.nudge.x, -state.nudge.y);
  state.nudge = { x: 0, y: 0 };
  renderScene();
}

function reverseOrder(which) {
  if (which === "a") state.t1Order.reverse();
  else state.t2Order.reverse();
  renderScene();
  scheduleVerification(30);
}

function toggleDegenerate() {
  if (!state.degenerate) {
    state.savedC = clonePoint(state.geometry.c);
    state.degenerate = true;
  } else {
    state.degenerate = false;
    if (state.savedC) state.geometry.c = clonePoint(state.savedC);
    state.savedC = null;
  }
  renderScene();
  scheduleVerification(30);
}

function resetScene() {
  state.geometry = cloneGeometry(DEFAULT_GEOMETRY);
  state.t1Order = [...DEFAULT_T1_ORDER];
  state.t2Order = [...DEFAULT_T2_ORDER];
  state.activeTriangle = "a";
  state.activeEdge = 0;
  state.selectedPixel = { ...DEFAULT_PIXEL };
  state.hoverPixel = null;
  state.dragging = null;
  state.nudge = { x: 0, y: 0 };
  state.degenerate = false;
  state.savedC = null;
  state.view = "color";
  renderScene();
  runVerificationNow();
}

dom.canvas.addEventListener("pointerdown", (event) => {
  const position = pointerPosition(event);
  const handle = findHandle(position);
  dom.canvas.focus();

  if (handle) {
    event.preventDefault();
    startDrag(handle, event);
    return;
  }

  state.selectedPixel = screenToPixel(position.x, position.y);
  state.hoverPixel = state.selectedPixel;
  renderScene();
});

dom.canvas.addEventListener("pointermove", (event) => {
  const position = pointerPosition(event);

  if (state.dragging) {
    moveHandle(state.dragging, position);
    renderScene();
    scheduleVerification();
    return;
  }

  const pixel = screenToPixel(position.x, position.y);
  const previous = state.hoverPixel;
  if (!previous || previous.x !== pixel.x || previous.y !== pixel.y) {
    state.hoverPixel = pixel;
    renderScene();
  }
});

dom.canvas.addEventListener("pointerup", endDrag);
dom.canvas.addEventListener("pointercancel", endDrag);
dom.canvas.addEventListener("pointerleave", () => {
  if (state.dragging || !state.hoverPixel) return;
  state.hoverPixel = null;
  renderScene();
});

dom.canvas.addEventListener("keydown", (event) => {
  const movement = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }[event.key];
  if (!movement) return;

  event.preventDefault();
  state.selectedPixel = {
    x: clamp(state.selectedPixel.x + movement[0], 0, WIDTH - 1),
    y: clamp(state.selectedPixel.y + movement[1], 0, HEIGHT - 1),
  };
  state.hoverPixel = null;
  renderScene();
});

dom.viewTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  state.view = button.dataset.view;
  renderScene();
});

dom.triangleTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-triangle]");
  if (!button || button.dataset.triangle === state.activeTriangle) return;
  state.activeTriangle = button.dataset.triangle;
  renderScene();
});

dom.edgeList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edge]");
  if (!button) return;
  state.activeEdge = Number(button.dataset.edge);
  state.view = "edge";
  renderScene();
});

dom.overlayToggles.forEach((button) => {
  button.addEventListener("click", () => {
    state.overlays[button.dataset.overlay] =
      !state.overlays[button.dataset.overlay];
    renderScene();
  });
});

document.querySelectorAll("[data-nudge]").forEach((button) => {
  button.addEventListener("click", () => {
    const [x, y] = button.dataset.nudge.split(",").map(Number);
    nudgeGeometry(x, y);
  });
});

dom.centerNudge.addEventListener("click", resetNudge);
dom.orderT1.addEventListener("click", () => reverseOrder("a"));
dom.orderT2.addEventListener("click", () => reverseOrder("b"));
dom.degenerateBtn.addEventListener("click", toggleDegenerate);
dom.resetBtn.addEventListener("click", resetScene);
dom.rerunBtn.addEventListener("click", runVerificationNow);

let resizeTimer = null;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    setupCanvas();
    if (!state.scene) return;
    paintView();
    drawCanvas(effectiveGeometry());
  }, 80);
});

renderScene();
runVerificationNow();
