import { createDemoScene } from "./demo-data.js";
import {
  createBindPose,
  checkInverseBindMatrices,
  computeBoneWorlds,
  computeSkinningMatrices,
} from "./skeleton.js";
import { normalizeSkinWeights } from "./weights.js";
import { sampleCrossfade, poseToLocalMatrices } from "./animation.js";
import {
  buildNormalMatrices,
  checkSkinningData,
  highlightVerticesForBone,
  skinMeshCPU,
} from "./skinning.js";
import { SkinningRenderer } from "./renderer.js";

const canvas = document.querySelector("#render-canvas");
const errorOverlay = document.querySelector("#error-overlay");
const ui = {
  play: document.querySelector("#play-button"),
  bind: document.querySelector("#bind-button"),
  blend: document.querySelector("#blend-slider"),
  autoBlend: document.querySelector("#auto-blend"),
  debug: document.querySelector("#debug-toggle"),
  bone: document.querySelector("#bone-select"),
  boneVertexCount: document.querySelector("#bone-vertex-count"),
  vertex: document.querySelector("#vertex-slider"),
  vertexLabel: document.querySelector("#vertex-index-label"),
  blendLabel: document.querySelector("#blend-label"),
  animationLabel: document.querySelector("#animation-label"),
  validationStatus: document.querySelector("#validation-status"),
  inverseBind: document.querySelector("#inverse-bind-stat"),
  weightStat: document.querySelector("#weight-stat"),
  zeroWeight: document.querySelector("#zero-weight-stat"),
  bindStat: document.querySelector("#bind-stat"),
  cpuPosition: document.querySelector("#cpu-position"),
  cpuNormal: document.querySelector("#cpu-normal"),
  cpuWeights: document.querySelector("#cpu-weights"),
  palette: document.querySelector("#palette-stat"),
};

const scene = createDemoScene();
const { skeleton, animations } = scene;
const normalized = normalizeSkinWeights(
  scene.mesh.joints,
  scene.mesh.weights,
  skeleton.bones.length,
);
const mesh = {
  ...scene.mesh,
  joints: normalized.joints,
  weights: normalized.weights,
};
const bindPose = createBindPose(skeleton);
const inverseBindCheck = checkInverseBindMatrices(skeleton);
const weightCheck = checkSkinningData(mesh, skeleton.bones.length);
const state = {
  playing: true,
  bindMode: false,
  blend: 0.5,
  autoBlend: false,
  debugEnabled: true,
  selectedBone: skeleton.byName.get("RightUpperArm").index,
  selectedVertex: 0,
  animationTime: 0,
};

populateBoneSelect();
ui.vertex.max = String(mesh.positions.length / 3 - 1);
ui.vertex.value = String(chooseInspectorVertex());
state.selectedVertex = Number(ui.vertex.value);
updateSelectedBoneCount();
updateStaticValidation();

let renderer;
try {
  renderer = new SkinningRenderer(canvas, {
    mesh,
    boneCount: skeleton.bones.length,
    parentIndices: skeleton.bones.map((bone) => bone.parent),
  });
} catch (error) {
  errorOverlay.hidden = false;
  errorOverlay.textContent = error.message;
  throw error;
}

bindInterface();
let previousTime = performance.now();
let previousStatsTime = 0;
requestAnimationFrame(frame);

function frame(now) {
  const delta = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;
  if (state.playing && !state.bindMode) {
    state.animationTime += delta;
    if (state.autoBlend) {
      state.blend = 0.5 - 0.5 * Math.cos(state.animationTime * 1.15);
      ui.blend.value = String(Math.round(state.blend * 100));
      updateBlendLabels();
    }
  }

  let localMatrices;
  if (state.bindMode) {
    localMatrices = skeleton.bindLocalMatrices;
  } else {
    const pose = sampleCrossfade(
      animations.sway,
      animations.wave,
      state.animationTime,
      state.animationTime * 1.07 + 0.37,
      state.blend,
      bindPose,
    );
    localMatrices = poseToLocalMatrices(pose);
  }

  const worlds = computeBoneWorlds(skeleton, localMatrices);
  const skinMatrices = computeSkinningMatrices(skeleton, localMatrices, {
    forceBindPose: state.bindMode,
  });
  const normalMatrices = buildNormalMatrices(skinMatrices);
  const cpu = skinMeshCPU(mesh, skinMatrices, { normalMatrices, influences: 4 });

  renderer.render({
    skinMatrices,
    worlds,
    selectedBone: state.selectedBone,
    debugEnabled: state.debugEnabled,
    bindPose: state.bindMode,
  });

  if (now - previousStatsTime > 80) {
    updateLiveStats(cpu);
    previousStatsTime = now;
  }
  requestAnimationFrame(frame);
}

function bindInterface() {
  ui.play.addEventListener("click", () => {
    state.playing = !state.playing;
    ui.play.textContent = state.playing ? "暂停" : "播放";
  });

  ui.blend.addEventListener("input", () => {
    state.blend = Number(ui.blend.value) / 100;
    state.autoBlend = false;
    ui.autoBlend.checked = false;
    updateBlendLabels();
  });

  ui.autoBlend.addEventListener("change", () => {
    state.autoBlend = ui.autoBlend.checked;
  });

  ui.bind.addEventListener("click", () => {
    state.bindMode = !state.bindMode;
    ui.bind.textContent = state.bindMode ? "返回动画" : "切回绑定姿态";
    ui.blend.disabled = state.bindMode;
    ui.autoBlend.disabled = state.bindMode;
    ui.animationLabel.textContent = state.bindMode ? "BIND POSE" : "SWAY ↔ WAVE";
  });

  ui.debug.addEventListener("change", () => {
    state.debugEnabled = ui.debug.checked;
  });

  ui.bone.addEventListener("change", () => {
    state.selectedBone = Number(ui.bone.value);
    updateSelectedBoneCount();
  });

  ui.vertex.addEventListener("input", () => {
    state.selectedVertex = Number(ui.vertex.value);
    ui.vertexLabel.textContent = `#${state.selectedVertex}`;
  });
}

function populateBoneSelect() {
  for (const bone of skeleton.bones) {
    const option = document.createElement("option");
    option.value = String(bone.index);
    option.textContent = `${String(bone.index).padStart(2, "0")} · ${bone.name}`;
    ui.bone.append(option);
  }
  ui.bone.value = String(state.selectedBone);
}

function chooseInspectorVertex() {
  const highlight = highlightVerticesForBone(mesh, state.selectedBone, 4);
  const index = highlight.findIndex((weight) => weight > 0.7);
  return index < 0 ? 0 : index;
}

function updateSelectedBoneCount() {
  const highlight = highlightVerticesForBone(mesh, state.selectedBone, 4);
  const count = highlight.reduce((total, weight) => total + (weight > 0.01 ? 1 : 0), 0);
  ui.boneVertexCount.textContent = String(count);
}

function updateStaticValidation() {
  const allValid =
    inverseBindCheck.ok &&
    weightCheck.ok &&
    normalized.report.zeroWeightVertexCount === 0;
  ui.validationStatus.textContent = allValid ? "PASS" : "CHECK";
  ui.validationStatus.style.color = allValid ? "var(--green)" : "var(--orange)";
  ui.inverseBind.textContent = inverseBindCheck.ok
    ? `PASS · ${formatScientific(inverseBindCheck.worstError)}`
    : `FAIL · ${inverseBindCheck.failures[0]?.bone ?? "unknown"}`;
  ui.weightStat.textContent = weightCheck.ok
    ? `OK · Δ ${formatScientific(weightCheck.maxWeightError)}`
    : `FAIL · ${weightCheck.unnormalizedVertices} 顶点`;
  ui.zeroWeight.textContent =
    `${normalized.report.zeroWeightVertexCount} / ${normalized.report.fallbackVertexCount}`;
  ui.palette.textContent =
    `${skeleton.bones.length} × mat4 · ${skeleton.bones.length * 64} B/frame`;
}

function updateLiveStats(cpu) {
  const positionIndex = state.selectedVertex * 3;
  const influenceIndex = state.selectedVertex * 4;
  const position = Array.from(cpu.positions.slice(positionIndex, positionIndex + 3));
  const normal = Array.from(cpu.normals.slice(positionIndex, positionIndex + 3));
  ui.vertexLabel.textContent = `#${state.selectedVertex}`;
  ui.cpuPosition.textContent = formatVector(position);
  ui.cpuNormal.textContent = formatVector(normal);
  const influences = [];
  for (let slot = 0; slot < 4; slot += 1) {
    const weight = mesh.weights[influenceIndex + slot];
    if (weight > 0) {
      influences.push(`${skeleton.bones[mesh.joints[influenceIndex + slot]].name}:${weight.toFixed(2)}`);
    }
  }
  ui.cpuWeights.textContent = influences.join(" · ");
  ui.bindStat.textContent = state.bindMode
    ? `精确 · |Δp| ${formatScientific(cpu.maxPositionDelta)}`
    : "就绪 · 可切换";
  updateBlendLabels();
}

function updateBlendLabels() {
  ui.blendLabel.textContent = `${Math.round(state.blend * 100)}%`;
}

function formatVector(vector) {
  return `[${vector.map((value) => value.toFixed(3)).join(", ")}]`;
}

function formatScientific(value) {
  return value === 0 ? "0" : value.toExponential(1);
}
