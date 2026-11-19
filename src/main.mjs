import { VolumetricRenderer } from "./renderer.mjs";
import { referenceConfig, validationReport } from "./validation.mjs";

const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const settings = {
  view: params.get("view") || "final",
  steps: Number(params.get("steps") || 96),
  density: Number(params.get("density") || 0.42),
  intensity: Number(params.get("intensity") || 0.5),
  dither: params.get("dither") === "1",
  wdebug: Number(params.get("wdebug") || 0),
};

if (params.get("hud") === "0") {
  $("#panel").style.display = "none";
}

const stepsInput = $("#steps");
const densityInput = $("#density");
const intensityInput = $("#intensity");
const ditherInput = $("#dither");
const viewSelect = $("#view-select");

stepsInput.value = String(settings.steps);
densityInput.value = String(settings.density);
intensityInput.value = String(settings.intensity);
ditherInput.checked = settings.dither;
viewSelect.value = settings.view;

const canvas = $("#gpu-canvas");
const renderer = new VolumetricRenderer(canvas, settings);
let pendingFrame = 0;

function requestRender() {
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    renderer.render();
  });
}

function syncReadouts() {
  $("#steps-out").value = String(settings.steps);
  $("#step-readout").textContent = String(settings.steps);
  $("#density-out").value = settings.density.toFixed(2);
  $("#intensity-out").value = settings.intensity.toFixed(1);
  $("#vol-res").textContent = `${renderer.halfWidth}×${renderer.halfHeight}`;
  const config = referenceConfig();
  config.sigmaT = 0.28;
  config.density = settings.density;
  const report = validationReport(settings.steps, config);
  $("#trans-error").textContent = report.transmittanceError.toExponential(1);
  $("#conv-error").textContent = `${(report.convergenceError * 100).toFixed(4)}%`;
  const legend = $("#legend");
  if (settings.view === "weights") {
    legend.textContent = "RGB = four-tap weights · cyan = depth rejection · navy = smooth tap";
  } else if (settings.view === "shadow") {
    legend.textContent = "2048² spot shadow depth · bright = nearer light · lines = 1/48 contours";
  } else {
    legend.textContent = "RGB = four-tap weights · cyan = depth rejection";
  }
}

function updateSettings() {
  settings.steps = Number(stepsInput.value);
  settings.density = Number(densityInput.value);
  settings.intensity = Number(intensityInput.value);
  settings.dither = ditherInput.checked;
  settings.view = viewSelect.value;
  syncReadouts();
  requestRender();
}

for (const input of [stepsInput, densityInput, intensityInput, ditherInput, viewSelect]) {
  input.addEventListener("input", updateSettings);
  input.addEventListener("change", updateSettings);
}

window.addEventListener("resize", () => {
  renderer.resize();
  syncReadouts();
  requestRender();
});

window.addEventListener("keydown", (event) => {
  const views = {
    "1": "final",
    "2": "half",
    "3": "weights",
    "4": "scene",
    "5": "shadow",
    "6": "guided",
  };
  if (views[event.key]) {
    viewSelect.value = views[event.key];
    updateSettings();
  }
});

try {
  await renderer.init();
  syncReadouts();
  $("#status").textContent = "Compute pass ready · depth-guided composite on";
  renderer.render();
} catch (error) {
  console.error(error);
  $("#status").textContent = "Initialization failed";
  const box = $("#error");
  box.hidden = false;
  box.textContent =
    `Unable to start the WebGPU volumetric demo.\n\n${error.message}\n\n` +
    "Use Chrome/Edge 113+ on localhost or HTTPS.";
}

window.__volumetric = {
  settings,
  renderer,
  render: () => renderer.render(),
  report: () => {
    const config = referenceConfig();
    config.sigmaT = 0.28;
    config.density = settings.density;
    return validationReport(settings.steps, config);
  },
};
