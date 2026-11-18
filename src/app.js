import { runBenchmarkSuite } from "./benchmark.js";
import { now } from "./factor.js";
import { HeatMethodSolver } from "./heat.js";
import { createDisconnectedMesh, createPlanarMesh, createSphereMesh } from "./mesh-generators.js";
import { MeshRenderer } from "./renderer.js";

const DENSITIES = [
  {
    label: "快速",
    planar: [22, 15],
    sphere: [28, 14],
    disconnected: [10, 12]
  },
  {
    label: "标准",
    planar: [30, 20],
    sphere: [36, 18],
    disconnected: [13, 16]
  },
  {
    label: "精细",
    planar: [36, 24],
    sphere: [44, 22],
    disconnected: [16, 20]
  }
];

const TITLES = {
  planar: ["平面三角网格", "PLANAR"],
  sphere: ["球面三角网格", "SPHERE"],
  disconnected: ["断开双片网格", "DISCONNECTED"]
};

const dom = {};
for (const id of [
  "meshVersion", "resolution", "resolutionLabel", "sourceLabel", "targetLabel",
  "connectivityCard", "connectivityTitle", "componentCount", "componentProgress",
  "connectivityNote", "cacheTitle", "cacheNote", "reusePill", "factorTime",
  "bandsToggle", "wireToggle", "sceneKind", "sceneTitle", "sceneSubtitle",
  "sceneChip", "selectionBanner", "selectionText", "cancelPick", "legendMax",
  "legendMid", "legendEnd", "loadingLayer", "loadingTitle", "loadingNote",
  "targetDistance", "resultCaption", "referenceDistance", "targetError",
  "solveTotal", "heatBar", "heatTime", "poissonBar", "poissonTime", "pathBar",
  "pathTime", "unknownCount", "timeStep", "pathPoints", "benchmarkList",
  "rerunBenchmark", "footerStatus", "meshStats", "fpsReadout", "resetView",
  "toggleRotate", "viewportShell"
]) {
  dom[id] = document.getElementById(id);
}

const state = {
  preset: "planar",
  density: 1,
  mesh: null,
  solver: null,
  result: null,
  source: -1,
  target: -1,
  pickMode: null,
  meshVersion: 0,
  meshToken: 0,
  benchmarkRunning: false,
  benchmark: null
};

let renderer;
try {
  renderer = new MeshRenderer(document.getElementById("glCanvas"));
} catch (error) {
  dom.loadingTitle.textContent = "无法启动 WebGL2";
  dom.loadingNote.textContent = error.message;
  throw error;
}

const overlay = document.getElementById("overlayCanvas");
const overlayContext = overlay.getContext("2d");
const format = (value, digits = 3) => (
  Number.isFinite(value) ? value.toFixed(digits) : "∞"
);

function meshFactory() {
  const density = DENSITIES[state.density];
  if (state.preset === "sphere") {
    return createSphereMesh(...density.sphere);
  }
  if (state.preset === "disconnected") {
    return createDisconnectedMesh(...density.disconnected);
  }
  return createPlanarMesh(...density.planar);
}

function setLoading(visible, title = "", note = "") {
  dom.loadingLayer.classList.toggle("hidden", !visible);
  if (title) dom.loadingTitle.textContent = title;
  if (note) dom.loadingNote.textContent = note;
}

function setPickMode(mode) {
  state.pickMode = mode;
  const active = mode === "source" || mode === "target";
  dom.selectionBanner.classList.toggle("visible", active);
  if (active) {
    dom.selectionText.textContent = mode === "source"
      ? "选择模式 · 点击网格设置源点"
      : "选择模式 · 点击网格设置目标点";
    renderer.canvas.style.cursor = "crosshair";
  } else {
    renderer.canvas.style.cursor = "grab";
  }
}

function reloadMesh() {
  const token = ++state.meshToken;
  state.meshVersion += 1;
  setLoading(true, "正在装配网格与预分解", "构建 cotan Laplacian · 缓存 Cholesky 因子");
  dom.footerStatus.textContent = "正在分解线性系统";
  requestAnimationFrame(() => {
    setTimeout(() => {
      if (token !== state.meshToken) return;
      const mesh = meshFactory();
      const factorStarted = now();
      const solver = new HeatMethodSolver(mesh);
      const factorMs = now() - factorStarted;
      state.mesh = mesh;
      state.solver = solver;
      state.source = mesh.suggested.source;
      state.target = mesh.suggested.target;
      state.result = null;
      renderer.setMesh(mesh);
      updateMeshInfo(factorMs);
      solveCurrent("mesh");
    }, 24);
  });
}

function updateMeshInfo(factorMs) {
  const mesh = state.mesh;
  const [title, kind] = TITLES[state.preset];
  dom.sceneTitle.textContent = title;
  dom.sceneKind.textContent = kind;
  dom.sceneSubtitle.textContent = meshSubtitle(mesh);
  dom.meshStats.textContent = `${mesh.vertexCount} VERTICES / ${mesh.faceCount} FACES`;
  dom.meshVersion.textContent = `v${String(state.meshVersion).padStart(2, "0")}`;
  dom.factorTime.textContent = `${factorMs.toFixed(1)} ms`;
  dom.cacheTitle.textContent = "预分解就绪";
  dom.cacheNote.textContent = `热核 + ${mesh.components.length} 个泊松系统`;
  dom.reusePill.textContent = "×0";
  dom.footerStatus.textContent = "预分解完成 · 正在求解";
}

function meshSubtitle(mesh) {
  const density = DENSITIES[state.density];
  if (state.preset === "sphere") {
    return `${density.sphere[0]} × ${density.sphere[1]} · ${mesh.vertexCount} vertices`;
  }
  if (state.preset === "disconnected") {
    return `2 patches · ${mesh.components.length} components · ${mesh.vertexCount} vertices`;
  }
  return `${density.planar[0]} × ${density.planar[1]} cells · ${mesh.vertexCount} vertices`;
}

function solveCurrent(reason) {
  const mesh = state.mesh;
  const solver = state.solver;
  if (!mesh || !solver) return;
  const started = now();
  const result = solver.solve(state.source, state.target);
  result.wallTime = now() - started;
  result.reference = mesh.referenceDistance(state.source, state.target);
  state.result = result;
  renderer.updateDistances(result);
  updateLegend();
  updateEndpointLabels();
  updateConnectivity();
  updateResult();
  updateTiming();
  updateCache(reason);
  setLoading(false);
  dom.footerStatus.textContent = result.targetReachable
    ? "求解完成 · 目标可达"
    : "求解完成 · 目标不可达";
}

function updateEndpointLabels() {
  dom.sourceLabel.textContent = `#${String(state.source).padStart(3, "0")}`;
  dom.targetLabel.textContent = `#${String(state.target).padStart(3, "0")}`;
}

function updateConnectivity() {
  const mesh = state.mesh;
  const result = state.result;
  const componentCount = mesh.components.length;
  const sourceComponent = mesh.componentOf[state.source];
  const reachableCount = mesh.components[sourceComponent].length;
  const multiple = componentCount > 1;
  dom.connectivityCard.classList.toggle("warning", multiple);
  dom.connectivityTitle.textContent = multiple ? `${componentCount} 个不连通分量` : "单连通分量";
  dom.componentCount.textContent = multiple
    ? `源点 ${reachableCount} / ${mesh.vertexCount}`
    : `1 / 1`;
  dom.componentProgress.style.transform = `scaleX(${reachableCount / mesh.vertexCount})`;
  dom.connectivityNote.textContent = multiple
    ? (result.targetReachable
      ? "目标与源点同属一个分量；其余分量保持不可达。"
      : "目标位于另一分量，距离保持 ∞，不进行欧氏填充。")
    : "所有顶点均可由源点到达，距离场覆盖完整网格。";
  dom.sceneChip.classList.toggle("warning", !result.targetReachable);
  dom.sceneChip.querySelector("span").textContent = multiple
    ? (result.targetReachable ? "MULTI-COMPONENT" : "TARGET UNREACHABLE")
    : "CONNECTED";
}

function updateResult() {
  const result = state.result;
  const mesh = state.mesh;
  if (!result) return;
  if (!result.targetReachable) {
    dom.targetDistance.classList.add("unreachable");
    dom.targetDistance.textContent = "不可达";
    dom.resultCaption.textContent = "不同连通分量 · 距离场保持 ∞";
    dom.referenceDistance.textContent = "—";
    dom.targetError.textContent = "未填充";
    dom.targetError.classList.add("bad");
    return;
  }
  const distance = result.distances[state.target];
  const reference = result.reference;
  dom.targetDistance.classList.remove("unreachable");
  dom.targetDistance.innerHTML = `${format(distance, 3)}<span>u</span>`;
  const referenceKind = state.preset === "sphere" ? "大圆参照" : "直线参照";
  dom.resultCaption.textContent = `${referenceKind} · ${result.path.length} 个路径采样点`;
  if (reference === null) {
    dom.referenceDistance.textContent = "—";
    dom.targetError.textContent = "无解析值";
    dom.targetError.classList.add("bad");
  } else {
    const error = Math.abs(distance - reference) / Math.max(reference, 1e-9);
    dom.referenceDistance.textContent = `${format(reference, 3)} u`;
    dom.targetError.textContent = reference < 1e-8 ? "精确" : `${(error * 100).toFixed(2)}%`;
    dom.targetError.classList.toggle("bad", error > 0.04);
  }
}

function updateTiming() {
  const result = state.result;
  if (!result) return;
  const { heat, poisson, total } = result.timings;
  const path = Math.max(0, total - heat - poisson);
  const maximum = Math.max(heat, poisson, path, 0.001);
  dom.heatTime.textContent = `${heat.toFixed(2)} ms`;
  dom.poissonTime.textContent = `${poisson.toFixed(2)} ms`;
  dom.pathTime.textContent = `${path.toFixed(2)} ms`;
  dom.heatBar.style.width = `${Math.max(4, heat / maximum * 100)}%`;
  dom.poissonBar.style.width = `${Math.max(4, poisson / maximum * 100)}%`;
  dom.pathBar.style.width = `${Math.max(4, path / maximum * 100)}%`;
  dom.solveTotal.textContent = `${total.toFixed(2)} ms`;
  dom.unknownCount.textContent = String(state.mesh.components[result.componentIndex].length);
  dom.timeStep.textContent = state.solver.timeStep.toFixed(4);
  dom.pathPoints.textContent = result.targetReachable ? String(result.path.length) : "0";
}

function updateCache(reason) {
  const solver = state.solver;
  if (!solver) return;
  dom.reusePill.textContent = `×${solver.reuseCount}`;
  dom.cacheTitle.textContent = solver.reuseCount > 0 ? "预分解已复用" : "预分解就绪";
  dom.cacheNote.textContent =
    `热核 + ${solver.poissonFactors.size} 泊松因子 · ${state.mesh.components.length} 连通块`;
  if (reason === "source" && solver.reuseCount > 0) {
    dom.reusePill.classList.add("bump");
    setTimeout(() => dom.reusePill.classList.remove("bump"), 340);
  }
}

function setBenchmarkLoading() {
  for (const row of dom.benchmarkList.querySelectorAll(".benchmark-row")) {
    row.classList.add("loading");
    row.querySelector(".benchmark-error").textContent = "--";
  }
  dom.rerunBenchmark.classList.add("spinning");
}

function renderBenchmarks(suite) {
  state.benchmark = suite;
  const planarRow = dom.benchmarkList.querySelector('[data-bench="planar"]');
  const sphereRow = dom.benchmarkList.querySelector('[data-bench="sphere"]');
  const splitRow = dom.benchmarkList.querySelector('[data-bench="disconnected"]');
  planarRow.classList.remove("loading");
  sphereRow.classList.remove("loading");
  splitRow.classList.remove("loading");
  planarRow.querySelector(".benchmark-error").textContent = `${(suite.planar.targetRelative * 100).toFixed(2)}%`;
  planarRow.querySelector(".benchmark-time").textContent = `${suite.planar.solveMs.toFixed(1)} ms`;
  planarRow.title = `平均相对误差 ${(suite.planar.error.meanRelative * 100).toFixed(2)}%`;
  sphereRow.querySelector(".benchmark-error").textContent = `${(suite.sphere.targetRelative * 100).toFixed(2)}%`;
  sphereRow.querySelector(".benchmark-time").textContent = `${suite.sphere.solveMs.toFixed(1)} ms`;
  sphereRow.title = `平均相对误差 ${(suite.sphere.error.meanRelative * 100).toFixed(2)}%`;
  const split = suite.disconnected;
  const passed = !split.targetReachable && !split.disconnectedComponentFilled && split.targetDistance === Infinity;
  splitRow.querySelector(".benchmark-error").textContent = passed ? "∞ 不可达" : "检查失败";
  splitRow.querySelector(".benchmark-error").classList.toggle("warn", !passed);
  splitRow.querySelector(".benchmark-time").textContent = passed ? "PASS" : "FAIL";
  dom.rerunBenchmark.classList.remove("spinning");
}

function runBenchmarks() {
  if (state.benchmarkRunning) return;
  state.benchmarkRunning = true;
  setBenchmarkLoading();
  setTimeout(() => {
    try {
      renderBenchmarks(runBenchmarkSuite());
    } catch (error) {
      console.error(error);
      dom.footerStatus.textContent = "基准测试失败";
    } finally {
      state.benchmarkRunning = false;
    }
  }, 40);
}

function pathPointVisible(point) {
  if (!state.mesh || state.mesh.kind !== "sphere") return true;
  const eye = renderer.camera.eye;
  return (
    (eye[0] - point[0]) * point[0] +
    (eye[1] - point[1]) * point[1] +
    (eye[2] - point[2]) * point[2]
  ) > -1e-7;
}

function drawTag(context, x, y, text, color, align = "left") {
  context.save();
  context.font = '8px "Geodesic Sans", "SFMono-Regular", monospace';
  const textWidth = context.measureText(text).width;
  const width = textWidth + 16;
  let left = align === "right" ? x - width : x;
  let top = y - 10;
  if (left + width > dom.viewportShell.clientWidth - 8) left = x - width - 16;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  if (top + 19 > dom.viewportShell.clientHeight - 8) top = dom.viewportShell.clientHeight - 27;
  context.fillStyle = "rgba(9, 14, 17, 0.84)";
  context.strokeStyle = `${color}55`;
  context.lineWidth = 0.7;
  context.beginPath();
  context.roundRect(left, top, width, 19, 4);
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.fillText(text, left + 8, top + 12.5);
  context.restore();
}

function drawMarker(context, point, color, label, type, behind = false) {
  const screen = renderer.project(point);
  if (!screen) return;
  const x = screen.x;
  const y = screen.y;
  context.save();
  context.globalAlpha = behind ? 0.4 : 1;
  const glow = context.createRadialGradient(x, y, 0, x, y, 22);
  glow.addColorStop(0, `${color}45`);
  glow.addColorStop(1, `${color}00`);
  context.fillStyle = glow;
  context.beginPath();
  context.arc(x, y, 22, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = `${color}99`;
  context.lineWidth = 1;
  context.setLineDash(behind ? [2, 2] : []);
  context.beginPath();
  context.arc(x, y, 9, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "#0a1013";
  context.beginPath();
  context.arc(x, y, 5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, type === "source" ? 2.7 : 2, 0, Math.PI * 2);
  context.fill();
  if (type === "target") {
    context.strokeStyle = color;
    context.lineWidth = 1;
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      context.beginPath();
      context.moveTo(x + Math.cos(angle) * 10, y + Math.sin(angle) * 10);
      context.lineTo(x + Math.cos(angle) * 14, y + Math.sin(angle) * 14);
      context.stroke();
    }
  }
  drawTag(context, x + 16, y - 1, label, color, "left");
  context.restore();
}

function drawHeatRings(context, point, time) {
  const screen = renderer.project(point);
  if (!screen) return;
  context.save();
  for (let ring = 0; ring < 3; ring += 1) {
    const phase = ((time / 850 + ring / 3) % 1);
    const radius = 12 + phase * 35;
    context.strokeStyle = `rgba(100, 225, 196, ${0.14 * (1 - phase)})`;
    context.lineWidth = 0.8;
    context.beginPath();
    context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function drawOverlay(time) {
  const rect = dom.viewportShell.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }
  const context = overlayContext;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  if (!state.mesh || !state.result) return;

  const sourcePoint = state.mesh.point(state.source);
  const targetPoint = state.mesh.point(state.target);
  drawHeatRings(context, sourcePoint, time);

  if (state.result.targetReachable && state.result.path.length > 1) {
    const projected = state.result.path.map((point) => ({
      point,
      screen: renderer.project(point)
    })).filter((entry) => entry.screen);
    if (projected.length > 1) {
      const gradient = context.createLinearGradient(
        projected[0].screen.x,
        projected[0].screen.y,
        projected[projected.length - 1].screen.x,
        projected[projected.length - 1].screen.y
      );
      gradient.addColorStop(0, "#ff9a73");
      gradient.addColorStop(0.52, "#f3c57d");
      gradient.addColorStop(1, "#66e1c5");
      const drawSegments = (lineWidth, color, blur) => {
        context.save();
        context.lineWidth = lineWidth;
        context.strokeStyle = color;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.shadowColor = "rgba(255, 176, 114, 0.45)";
        context.shadowBlur = blur;
        for (let index = 1; index < projected.length; index += 1) {
          if (!pathPointVisible(projected[index - 1].point) || !pathPointVisible(projected[index].point)) continue;
          context.beginPath();
          context.moveTo(projected[index - 1].screen.x, projected[index - 1].screen.y);
          context.lineTo(projected[index].screen.x, projected[index].screen.y);
          context.stroke();
        }
        context.restore();
      };
      drawSegments(8, "rgba(242, 172, 104, 0.09)", 12);
      drawSegments(2.2, gradient, 3);
      drawSegments(0.7, "rgba(255, 244, 221, 0.7)", 0);
    }
  }

  const sourceBehind = !pathPointVisible(sourcePoint);
  const targetBehind = !pathPointVisible(targetPoint);
  drawMarker(
    context,
    targetPoint,
    state.result.targetReachable ? "#ff8062" : "#ff756c",
    state.result.targetReachable ? `TARGET  #${state.target}` : `TARGET  #${state.target} · 不可达`,
    "target",
    targetBehind
  );
  drawMarker(context, sourcePoint, "#64e1c4", `SOURCE  #${state.source}`, "source", sourceBehind);

  if (state.mesh.components.length > 1) {
    const sourceComponent = state.mesh.componentOf[state.source];
    const other = state.mesh.components.findIndex((_, index) => index !== sourceComponent);
    if (other >= 0) {
      const vertices = state.mesh.components[other];
      const centroid = [0, 0, 0];
      for (const vertex of vertices) {
        const point = state.mesh.point(vertex);
        centroid[0] += point[0] / vertices.length;
        centroid[1] += point[1] / vertices.length;
        centroid[2] += point[2] / vertices.length;
      }
      const screen = renderer.project(centroid);
      if (screen) {
        context.save();
        context.font = '8px "Geodesic Sans", "SFMono-Regular", monospace';
        const text = "未连通分量 · 不可达";
        const textWidth = context.measureText(text).width;
        context.fillStyle = "rgba(35, 21, 20, 0.82)";
        context.strokeStyle = "rgba(255, 117, 108, 0.34)";
        context.lineWidth = 0.8;
        context.beginPath();
        context.roundRect(screen.x - textWidth / 2 - 9, screen.y + 25, textWidth + 18, 20, 5);
        context.fill();
        context.stroke();
        context.fillStyle = "#ff9c92";
        context.textAlign = "center";
        context.fillText(text, screen.x, screen.y + 38);
        context.restore();
      }
    }
  }
}

function updateLegend() {
  const maximum = renderer.maxDistance;
  dom.legendMax.textContent = format(maximum, 2);
  dom.legendMid.textContent = format(maximum / 2, 2);
  dom.legendEnd.textContent = format(maximum, 2);
}

function updateRangeFill() {
  const value = Number(dom.resolution.value);
  dom.resolution.style.setProperty("--range-fill", `${value / 2 * 100}%`);
  dom.resolutionLabel.textContent = DENSITIES[value].label;
}

let resolutionTimer = 0;
dom.resolution.addEventListener("input", () => {
  state.density = Number(dom.resolution.value);
  updateRangeFill();
  clearTimeout(resolutionTimer);
  resolutionTimer = setTimeout(reloadMesh, 220);
});

for (const button of document.querySelectorAll(".preset")) {
  button.addEventListener("click", () => {
    const preset = button.dataset.preset;
    if (preset === state.preset) return;
    state.preset = preset;
    for (const peer of document.querySelectorAll(".preset")) {
      peer.classList.toggle("active", peer === button);
    }
    setPickMode(null);
    reloadMesh();
  });
}

for (const button of document.querySelectorAll("[data-pick]")) {
  button.addEventListener("click", () => {
    const mode = button.dataset.pick;
    setPickMode(state.pickMode === mode ? null : mode);
    for (const peer of document.querySelectorAll("[data-pick]")) {
      peer.classList.toggle("active", state.pickMode === peer.dataset.pick);
    }
  });
}

dom.cancelPick.addEventListener("click", () => {
  setPickMode(null);
  for (const peer of document.querySelectorAll("[data-pick]")) peer.classList.remove("active");
});

let pointerDown = false;
let pointerMoved = false;
let pointerStart = null;
let pointerLast = null;
const canvas = renderer.canvas;

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pointerDown = true;
  pointerMoved = false;
  pointerStart = { x: event.clientX, y: event.clientY };
  pointerLast = { ...pointerStart };
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = "grabbing";
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerDown || !pointerLast) return;
  const deltaX = event.clientX - pointerLast.x;
  const deltaY = event.clientY - pointerLast.y;
  pointerLast = { x: event.clientX, y: event.clientY };
  if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 3) {
    pointerMoved = true;
  }
  if (pointerMoved) renderer.rotate(deltaX, deltaY);
});

function finishPointer(event) {
  if (!pointerDown) return;
  pointerDown = false;
  canvas.style.cursor = state.pickMode ? "crosshair" : "grab";
  if (!pointerMoved && state.mesh) {
    const rect = canvas.getBoundingClientRect();
    const hit = renderer.pickAt(event.clientX - rect.left, event.clientY - rect.top);
    if (hit) {
      const mode = state.pickMode || "source";
      if (mode === "source") state.source = hit.vertex;
      else state.target = hit.vertex;
      setPickMode(null);
      for (const peer of document.querySelectorAll("[data-pick]")) peer.classList.remove("active");
      solveCurrent(mode);
    }
  }
  pointerLast = null;
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", () => {
  pointerDown = false;
  pointerLast = null;
  canvas.style.cursor = state.pickMode ? "crosshair" : "grab";
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  renderer.zoom(event.deltaY);
}, { passive: false });

dom.resetView.addEventListener("click", () => {
  renderer.resetCamera(state.preset);
});

dom.toggleRotate.addEventListener("click", () => {
  renderer.autoRotate = !renderer.autoRotate;
  dom.toggleRotate.classList.toggle("active", renderer.autoRotate);
});

dom.bandsToggle.addEventListener("change", () => {
  renderer.setBandSettings(dom.bandsToggle.checked, renderer.bandCount);
});

dom.wireToggle.addEventListener("change", () => {
  renderer.setWire(dom.wireToggle.checked);
});

dom.rerunBenchmark.addEventListener("click", runBenchmarks);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setPickMode(null);
    for (const peer of document.querySelectorAll("[data-pick]")) peer.classList.remove("active");
  }
  if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey) {
    renderer.resetCamera(state.preset);
  }
});

let frameCount = 0;
let fpsStarted = now();
function animate(time) {
  renderer.render();
  drawOverlay(time);
  frameCount += 1;
  if (time - fpsStarted > 650) {
    dom.fpsReadout.textContent = String(Math.round(frameCount * 1000 / (time - fpsStarted)));
    frameCount = 0;
    fpsStarted = time;
  }
  requestAnimationFrame(animate);
}

updateRangeFill();
updateLegend();
reloadMesh();
setTimeout(runBenchmarks, 900);
requestAnimationFrame(animate);
