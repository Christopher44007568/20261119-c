import { NEUTRAL_TEXEL, bakeNormalMap } from "./bake.js";
import { createHighLowModel } from "./geometry.js";
import { buildBVH } from "./math.js";
import { createSoftwareRenderer } from "./renderer.js";
import { runValidation } from "./validation.js";

const model = createHighLowModel();
const bvh = buildBVH(model.highTriangles);
const renderer = createSoftwareRenderer(document.getElementById("compareCanvas"));

const state = {
  resolution: 384,
  cageDistance: 0.11,
  projection: "cage",
  mirrorCorrection: true,
  repairPenetration: true,
  mode: "normal",
  stageOverlays: { seams: true, cage: false },
  textureOverlays: {
    seam: true,
    miss: false,
    false: false,
    penetration: false,
    mirror: false,
  },
};

let bakeResult = null;
let validationResult = null;
let baking = false;
let bakeQueued = false;
let renderQueued = false;
let bakeTimer = null;

const dom = {
  compareCanvas: document.getElementById("compareCanvas"),
  textureCanvas: document.getElementById("textureCanvas"),
  viewTabs: document.getElementById("viewTabs"),
  resetViewBtn: document.getElementById("resetViewBtn"),
  bakeBusy: document.getElementById("bakeBusy"),
  busyText: document.getElementById("busyText"),
  bakeBtn: document.getElementById("bakeBtn"),
  exportBtn: document.getElementById("exportBtn"),
  bakeState: document.getElementById("bakeState"),
  resolutionControl: document.getElementById("resolutionControl"),
  projectionControl: document.getElementById("projectionControl"),
  cageRange: document.getElementById("cageRange"),
  cageField: document.getElementById("cageField"),
  cageReadout: document.getElementById("cageReadout"),
  projectionHint: document.getElementById("projectionHint"),
  resolutionReadout: document.getElementById("resolutionReadout"),
  headerResolution: document.getElementById("headerResolution"),
  mirrorToggle: document.getElementById("mirrorToggle"),
  repairToggle: document.getElementById("repairToggle"),
  statHitRate: document.getElementById("statHitRate"),
  statHitNote: document.getElementById("statHitNote"),
  statMiss: document.getElementById("statMiss"),
  statFalse: document.getElementById("statFalse"),
  statPenetration: document.getElementById("statPenetration"),
  statRepairNote: document.getElementById("statRepairNote"),
  statError: document.getElementById("statError"),
  highTriangleStat: document.getElementById("highTriangleStat"),
  lowTriangleStat: document.getElementById("lowTriangleStat"),
  uvCoverage: document.getElementById("uvCoverage"),
  seamCount: document.getElementById("seamCount"),
  errorP95: document.getElementById("errorP95"),
  textureMeta: document.getElementById("textureMeta"),
  validationBadge: document.getElementById("validationBadge"),
  validationList: document.getElementById("validationList"),
  validationSummary: document.getElementById("validationSummary"),
  validationAngle: document.getElementById("validationAngle"),
  tbnRgb: document.getElementById("tbnRgb"),
  cameraYaw: document.getElementById("cameraYaw"),
  cameraPitch: document.getElementById("cameraPitch"),
  renderModeReadout: document.getElementById("renderModeReadout"),
  renderTime: document.getElementById("renderTime"),
  footerStatus: document.getElementById("footerStatus"),
  maskGrid: document.getElementById("maskGrid"),
};

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
}

function formatSignedDegrees(radians) {
  const degrees = (radians * 180) / Math.PI;
  const sign = degrees >= 0 ? "+" : "−";
  return `YAW ${sign}${Math.abs(degrees).toFixed(0).padStart(2, "0")}°`;
}

function currentScene() {
  return {
    model,
    bake: bakeResult,
    mode: state.mode,
    overlays: state.stageOverlays,
    cageDistance: state.cageDistance,
    mirrorCorrection: state.mirrorCorrection,
  };
}

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const timing = renderer.render(currentScene());
    const view = renderer.getView();
    dom.cameraYaw.textContent = formatSignedDegrees(view.yaw);
    dom.cameraPitch.textContent = `PITCH ${Math.round((view.pitch * 180) / Math.PI)
      .toString()
      .padStart(2, "0")}°`;
    dom.renderTime.textContent = `${timing.elapsedMs.toFixed(1)} ms`;
    dom.renderModeReadout.textContent = {
      normal: "NORMAL RECONSTRUCTION",
      lit: "LIT COMPARISON",
      error: "ANGLE ERROR / DEGREES",
    }[state.mode];
  });
}

function setBusy(active) {
  baking = active;
  dom.bakeBusy.hidden = !active;
  dom.bakeBtn.disabled = active;
  dom.bakeState.classList.toggle("is-working", active);
  dom.bakeState.innerHTML = active ? "<i></i>BAKING" : "<i></i>READY";
}

function performBake() {
  if (baking) {
    bakeQueued = true;
    return;
  }
  setBusy(true);
  dom.busyText.textContent = `${state.resolution}² texels · ${state.projection === "cage" ? "CAGE" : "NEAREST"}`;
  bakeQueued = false;

  window.setTimeout(() => {
    bakeResult = bakeNormalMap({
      model,
      bvh,
      resolution: state.resolution,
      cageDistance: state.cageDistance,
      projection: state.projection,
      repairPenetration: state.repairPenetration,
    });
    validationResult = runValidation(bakeResult, state.mirrorCorrection);
    updateInterface();
    renderTexture();
    renderMasks();
    requestRender();
    setBusy(false);
    if (bakeQueued) {
      bakeQueued = false;
      performBake();
    }
  }, 30);
}

function scheduleBake(delay = 220) {
  window.clearTimeout(bakeTimer);
  dom.bakeBtn.disabled = true;
  dom.bakeState.innerHTML = "<i></i>PENDING";
  bakeTimer = window.setTimeout(() => {
    dom.bakeBtn.disabled = false;
    performBake();
  }, delay);
}

function updateInterface() {
  if (!bakeResult) return;
  const metrics = bakeResult.metrics;
  const size = bakeResult.resolution;
  const coveredPercent = (metrics.coveredCount / (size * size)) * 100;

  dom.statHitRate.textContent = `${(metrics.hitRate * 100).toFixed(1)}%`;
  dom.statHitNote.textContent = `${formatNumber(metrics.hitCount)} / ${formatNumber(metrics.coveredCount)} texels`;
  dom.statMiss.textContent = formatNumber(metrics.missCount);
  dom.statFalse.textContent = formatNumber(metrics.falseHitCount);
  dom.statPenetration.textContent = formatNumber(metrics.penetrationCount);
  dom.statRepairNote.textContent = `${metrics.repairedCount} repaired`;
  dom.statError.textContent = `${metrics.meanError.toFixed(2)}°`;
  dom.uvCoverage.textContent = `${coveredPercent.toFixed(1)}%`;
  dom.seamCount.textContent = formatNumber(metrics.seamCount);
  dom.errorP95.textContent = `${metrics.errorP95.toFixed(1)}°`;
  dom.textureMeta.textContent = `RGBA8 / ${size}² / ${(metrics.elapsedMs / 1000).toFixed(2)} s`;
  dom.headerResolution.textContent = `${size} × ${size}`;
  dom.footerStatus.textContent = `${size} × ${size} · ${state.projection.toUpperCase()} ${state.cageDistance.toFixed(3)} · OPENGL +Y`;
  dom.highTriangleStat.textContent = `${(model.highTriangleCount / 1000).toFixed(1)}K TRI`;
  dom.lowTriangleStat.textContent = `${model.lowTriangleCount} TRI`;
  dom.resolutionReadout.textContent = `${state.resolution} × ${state.resolution}`;
  dom.projectionHint.textContent =
    state.projection === "cage" ? "沿笼面法线向内" : "双向最近表面搜索";

  dom.validationBadge.textContent = validationResult.allPass ? "PASS" : "FAIL";
  dom.validationBadge.classList.toggle("is-fail", !validationResult.allPass);
  dom.validationSummary.textContent = validationResult.summary;
  dom.validationAngle.textContent = `Δ ${validationResult.maxError.toFixed(2)}°`;

  dom.validationList.replaceChildren();
  for (const test of validationResult.tests) {
    const row = document.createElement("div");
    row.className = "verify-row";
    const icon = document.createElement("span");
    icon.className = `verify-icon${test.pass ? "" : " is-fail"}`;
    icon.textContent = test.pass ? "✓" : "!";
    const label = document.createElement("span");
    label.className = "verify-label";
    label.textContent = test.label;
    const value = document.createElement("span");
    value.className = "verify-value";
    value.textContent = test.value;
    row.append(icon, label, value);
    dom.validationList.append(row);
  }

  const fixture = validationResult.fixture;
  const bars = dom.tbnRgb.querySelectorAll("span");
  const colors = [fixture.leftEncoded.rgb, fixture.mirroredEncoded.rgb, NEUTRAL_TEXEL.slice(0, 3)];
  bars.forEach((bar, index) => {
    bar.style.background = `rgb(${colors[index].join(",")})`;
    bar.title =
      index < 2
        ? `tangent-space normal ${colors[index].join(", ")}`
        : "neutral fallback 128, 128, 255";
  });
}

function blendPixel(data, offset, color, alpha) {
  data[offset] = data[offset] * (1 - alpha) + color[0] * alpha;
  data[offset + 1] = data[offset + 1] * (1 - alpha) + color[1] * alpha;
  data[offset + 2] = data[offset + 2] * (1 - alpha) + color[2] * alpha;
}

function renderTexture() {
  if (!bakeResult) return;
  const size = bakeResult.resolution;
  const canvas = dom.textureCanvas;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { alpha: false });
  const image = context.createImageData(size, size);
  const data = image.data;
  const texture = bakeResult.texture;
  const raster = bakeResult.raster;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const offset = index * 4;
      if (!raster.coverage[index]) {
        const checker = (Math.floor(x / 7) ^ Math.floor(y / 7)) & 1;
        const tone = checker ? 12 : 8;
        data[offset] = tone;
        data[offset + 1] = tone + 3;
        data[offset + 2] = tone + 4;
        data[offset + 3] = 255;
        continue;
      }

      data[offset] = texture[offset];
      data[offset + 1] = texture[offset + 1];
      data[offset + 2] = texture[offset + 2];
      data[offset + 3] = 255;

      if (state.textureOverlays.mirror && raster.mirrored[index]) {
        blendPixel(data, offset, [88, 217, 232], 0.16);
      }
      if (state.textureOverlays.penetration && bakeResult.penetrationMask[index]) {
        blendPixel(data, offset, [255, 180, 92], 0.8);
      }
      if (state.textureOverlays.false && bakeResult.falseMask[index]) {
        blendPixel(data, offset, [255, 105, 200], 0.82);
      }
      if (state.textureOverlays.miss && bakeResult.missMask[index]) {
        blendPixel(data, offset, [255, 93, 118], 0.88);
      }
      if (state.textureOverlays.seam && raster.seam[index]) {
        blendPixel(data, offset, [255, 211, 83], 0.94);
      }
    }
  }

  context.putImageData(image, 0, 0);
}

function renderMaskCanvas(canvas, kind) {
  if (!bakeResult) return;
  const width = canvas.width;
  const height = canvas.height;
  const context = canvas.getContext("2d", { alpha: false });
  const image = context.createImageData(width, height);
  const data = image.data;
  const size = bakeResult.resolution;
  const raster = bakeResult.raster;
  const colors = {
    miss: [255, 93, 118],
    false: [255, 105, 200],
    penetration: [255, 180, 92],
    mirror: [88, 217, 232],
  };
  const masks = {
    miss: bakeResult.missMask,
    false: bakeResult.falseMask,
    penetration: bakeResult.penetrationMask,
    mirror: raster.mirrored,
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tx = Math.min(size - 1, Math.floor((x / width) * size));
      const ty = Math.min(size - 1, Math.floor((y / height) * size));
      const source = ty * size + tx;
      const offset = (y * width + x) * 4;
      const covered = raster.coverage[source];
      const active = masks[kind][source];
      const base = covered ? 19 : 9;
      data[offset] = base;
      data[offset + 1] = base + 3;
      data[offset + 2] = base + 4;
      data[offset + 3] = 255;
      if (active) {
        const color = colors[kind];
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
      }
    }
  }
  context.putImageData(image, 0, 0);
}

function renderMasks() {
  if (!bakeResult) return;
  const values = {
    miss: bakeResult.metrics.missCount,
    false: bakeResult.metrics.falseHitCount,
    penetration: bakeResult.metrics.penetrationCount,
    mirror: bakeResult.metrics.mirroredCount,
  };
  for (const card of dom.maskGrid.querySelectorAll("[data-mask-card]")) {
    const kind = card.dataset.maskCard;
    renderMaskCanvas(card.querySelector("canvas"), kind);
    const value = card.querySelector("figcaption b");
    value.textContent = kind === "mirror" ? "R" : formatNumber(values[kind]);
  }
}

function setActiveButton(container, attribute, value) {
  for (const button of container.querySelectorAll(`[${attribute}]`)) {
    button.classList.toggle("is-active", button.getAttribute(attribute) === String(value));
  }
}

function updateCageControl() {
  dom.cageReadout.textContent = state.cageDistance.toFixed(3);
  const minimum = Number(dom.cageRange.min);
  const maximum = Number(dom.cageRange.max);
  const percent = ((state.cageDistance - minimum) / (maximum - minimum)) * 100;
  dom.cageRange.style.setProperty("--range-fill", `${percent}%`);
  dom.cageField.classList.toggle("is-disabled", state.projection === "nearest");
}

function exportTexture() {
  if (!bakeResult) return;
  const size = bakeResult.resolution;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = size;
  exportCanvas.height = size;
  const context = exportCanvas.getContext("2d");
  const image = context.createImageData(size, size);
  image.data.set(bakeResult.texture);
  context.putImageData(image, 0, 0);
  exportCanvas.toBlob((blob) => {
    if (!blob) return;
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `low_normal_${size}_${state.projection}_${state.cageDistance.toFixed(3)}.png`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  }, "image/png");
}

function updateCameraReadout() {
  const view = renderer.getView();
  dom.cameraYaw.textContent = formatSignedDegrees(view.yaw);
  dom.cameraPitch.textContent = `PITCH ${Math.round((view.pitch * 180) / Math.PI)
    .toString()
    .padStart(2, "0")}°`;
}

function bindControls() {
  dom.resolutionControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-resolution]");
    if (!button) return;
    state.resolution = Number(button.dataset.resolution);
    setActiveButton(dom.resolutionControl, "data-resolution", state.resolution);
    updateCageControl();
    scheduleBake();
  });

  dom.projectionControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-projection]");
    if (!button) return;
    state.projection = button.dataset.projection;
    setActiveButton(dom.projectionControl, "data-projection", state.projection);
    updateCageControl();
    dom.projectionHint.textContent =
      state.projection === "cage" ? "沿笼面法线向内" : "双向最近表面搜索";
    scheduleBake(80);
  });

  dom.cageRange.addEventListener("input", () => {
    state.cageDistance = Number(dom.cageRange.value);
    updateCageControl();
    requestRender();
  });
  dom.cageRange.addEventListener("change", () => scheduleBake(80));

  dom.mirrorToggle.addEventListener("change", () => {
    state.mirrorCorrection = dom.mirrorToggle.checked;
    if (bakeResult) {
      validationResult = runValidation(bakeResult, state.mirrorCorrection);
      updateInterface();
    }
    requestRender();
  });

  dom.repairToggle.addEventListener("change", () => {
    state.repairPenetration = dom.repairToggle.checked;
    scheduleBake(80);
  });

  dom.viewTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    state.mode = button.dataset.view;
    setActiveButton(dom.viewTabs, "data-view", state.mode);
    requestRender();
  });

  for (const button of document.querySelectorAll("[data-stage-overlay]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.stageOverlay;
      state.stageOverlays[key] = !state.stageOverlays[key];
      button.classList.toggle("is-on", state.stageOverlays[key]);
      requestRender();
    });
  }

  for (const button of document.querySelectorAll("[data-texture-overlay]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.textureOverlay;
      state.textureOverlays[key] = !state.textureOverlays[key];
      button.classList.toggle("is-on", state.textureOverlays[key]);
      renderTexture();
    });
  }

  dom.bakeBtn.addEventListener("click", () => {
    window.clearTimeout(bakeTimer);
    performBake();
  });
  dom.exportBtn.addEventListener("click", exportTexture);
  dom.resetViewBtn.addEventListener("click", () => {
    renderer.resetView();
    updateCameraReadout();
    requestRender();
  });

  let drag = null;
  dom.compareCanvas.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY };
    dom.compareCanvas.classList.add("is-dragging");
    dom.compareCanvas.setPointerCapture(event.pointerId);
  });
  dom.compareCanvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    renderer.orbit(event.clientX - drag.x, event.clientY - drag.y);
    drag = { x: event.clientX, y: event.clientY };
    updateCameraReadout();
    requestRender();
  });
  const stopDragging = (event) => {
    if (!drag) return;
    drag = null;
    dom.compareCanvas.classList.remove("is-dragging");
    if (event.pointerId !== undefined && dom.compareCanvas.hasPointerCapture(event.pointerId)) {
      dom.compareCanvas.releasePointerCapture(event.pointerId);
    }
  };
  dom.compareCanvas.addEventListener("pointerup", stopDragging);
  dom.compareCanvas.addEventListener("pointercancel", stopDragging);
  dom.compareCanvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      renderer.zoom(event.deltaY);
      requestRender();
    },
    { passive: false },
  );
  dom.compareCanvas.addEventListener("dblclick", () => {
    renderer.resetView();
    updateCameraReadout();
    requestRender();
  });

  new ResizeObserver(() => requestRender()).observe(dom.compareCanvas);
}

function initialize() {
  dom.mirrorToggle.checked = state.mirrorCorrection;
  dom.repairToggle.checked = state.repairPenetration;
  dom.exportBtn.disabled = false;
  updateCageControl();
  updateCameraReadout();
  bindControls();
  performBake();
}

initialize();
