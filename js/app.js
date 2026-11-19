import {
  DEFAULT_CONFIG,
  buildReference,
  isRunCurrent,
  normalizeConfig,
  toFloat32,
  validateConfig,
} from "./core.js";
import { compareResults } from "./compare.js";
import { createCustomImage, createPreset } from "./datasets.js";
import { runCpuFallback } from "./cpu-engine.js";
import { createGpuEngine } from "./gpu-engine.js";
import { ui } from "./ui.js";

const MAX_PIXELS = 8_000_000;
const READBACK_DELAY_MS = 180;

const state = {
  config: normalizeConfig(DEFAULT_CONFIG),
  presetId: "partial",
  data: null,
  revision: 0,
  runToken: 0,
  latestRunToken: 0,
  appliedRevision: null,
  reference: null,
  result: null,
  comparison: null,
  engine: null,
  engineKind: "cpu",
  engineReason: "WebGPU 尚未初始化",
  activity: [],
  debounceTimer: 0,
  fileReadToken: 0,
};

const elements = ui.elements;
const fieldIds = {
  width: "imageWidth",
  height: "imageHeight",
  bins: "binsInput",
  min: "minInput",
  max: "maxInput",
  workgroup: "workgroupSelect",
};

function clampInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

function readInputState() {
  const width = clampInteger(document.getElementById(fieldIds.width).value, 0, 4096);
  const height = clampInteger(document.getElementById(fieldIds.height).value, 0, 4096);
  const rawConfig = {
    bins: Number(document.getElementById(fieldIds.bins).value),
    min: Number(document.getElementById(fieldIds.min).value),
    max: Number(document.getElementById(fieldIds.max).value),
    workgroupSize: Number(document.getElementById(fieldIds.workgroup).value),
  };
  const validation = validateConfig(rawConfig);
  const errors = [...validation.errors];
  let config = null;
  if (validation.ok) {
    try {
      config = normalizeConfig(rawConfig);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (width * height > MAX_PIXELS) {
    errors.push(`图像不得超过 ${MAX_PIXELS.toLocaleString("en-US")} 个像素`);
  }
  return {
    width,
    height,
    rawConfig,
    config,
    errors,
  };
}

function updateReadout(input = readInputState()) {
  const { rawConfig } = input;
  if (
    Number.isFinite(rawConfig.min) &&
    Number.isFinite(rawConfig.max) &&
    Number.isFinite(rawConfig.bins) &&
    rawConfig.bins > 0
  ) {
    ui.updateReadout(rawConfig);
  }
  ui.setConfigError(input.errors);
}

function currentSnapshot(revision = state.revision) {
  const data = state.data;
  return {
    revision,
    config: { ...state.config },
    values: toFloat32(data.values),
    width: data.width,
    height: data.height,
    label: data.label,
    eyebrow: data.eyebrow,
    description: data.description,
    presetId: data.id,
  };
}

function logActivity(revision, text, type = "normal") {
  state.activity.unshift({ revision, text, type });
  state.activity = state.activity.slice(0, 7);
  ui.renderActivity(state.activity);
}

function markInputDirty(label = "输入已变更") {
  state.revision += 1;
  state.latestRunToken += 1;
  state.appliedRevision = null;
  state.result = null;
  state.comparison = null;
  state.reference = null;
  const snapshot = currentSnapshot();
  ui.renderPending(snapshot, null, label);
}

function scheduleRun(reason, delay = 260) {
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    submitRun(reason);
  }, delay);
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function setPresetButtons(activeId) {
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.preset === activeId);
  });
}

function updateData(data, options = {}) {
  state.data = data;
  state.presetId = data.id;
  if (options.syncFields !== false) {
    document.getElementById(fieldIds.width).value = data.width;
    document.getElementById(fieldIds.height).value = data.height;
  }
  setPresetButtons(options.keepSelection === false ? "" : data.id);
}

async function executeSnapshot(snapshot, runToken, engineKind, slowReadback) {
  let result;
  if (engineKind === "webgpu") {
    result = await state.engine.run(snapshot);
    if (slowReadback) {
      await sleep(READBACK_DELAY_MS);
    }
  } else {
    result = await runCpuFallback(
      snapshot,
      slowReadback ? READBACK_DELAY_MS : 0,
    );
  }
  return { result, runToken };
}

async function submitRun(reason = "manual") {
  clearTimeout(state.debounceTimer);
  const input = readInputState();
  updateReadout(input);
  if (input.errors.length > 0) {
    ui.toast(input.errors[0], true);
    return;
  }

  state.config = input.config;
  if (state.data.width !== input.width || state.data.height !== input.height) {
    state.data = createCustomImage(input.width, input.height, state.config);
    setPresetButtons("");
  }
  const snapshot = currentSnapshot();
  const runToken = state.runToken + 1;
  state.runToken = runToken;
  state.latestRunToken = runToken;
  state.appliedRevision = null;
  state.result = null;
  state.comparison = null;
  state.reference = buildReference(snapshot.values, snapshot.config);
  const slowReadback = elements.slowReadback.checked;
  const engineKind = state.engine ? "webgpu" : "cpu";

  ui.renderPending(
    snapshot,
    state.reference,
    engineKind === "webgpu" ? "GPU 计算与回读中" : "CPU 精确仿真中",
  );
  logActivity(
    snapshot.revision,
    `提交 ${snapshot.label} · ${snapshot.values.length.toLocaleString("en-US")} samples · ${reason}`,
  );

  try {
    const { result } = await executeSnapshot(
      snapshot,
      runToken,
      engineKind,
      slowReadback,
    );
    const current = isRunCurrent(
      snapshot.revision,
      runToken,
      state.revision,
      state.latestRunToken,
    );
    if (!current) {
      logActivity(
        snapshot.revision,
        `回读完成 · 已丢弃（当前输入 v${String(state.revision).padStart(2, "0")}）`,
        "stale",
      );
      return;
    }

    const comparison = compareResults(state.reference, result);
    state.result = result;
    state.comparison = comparison;
    state.appliedRevision = snapshot.revision;
    ui.renderResults(
      snapshot,
      state.reference,
      result,
      comparison,
      engineKind,
    );
    logActivity(
      snapshot.revision,
      comparison.allPass
        ? `已应用 · CPU 精确计数 PASS · Δ 0`
        : `已应用 · 校验 FAIL · Δ ${comparison.totalDifference}`,
      comparison.allPass ? "normal" : "stale",
    );
  } catch (error) {
    const current = isRunCurrent(
      snapshot.revision,
      runToken,
      state.revision,
      state.latestRunToken,
    );
    if (!current) {
      logActivity(
        snapshot.revision,
        `旧版本执行结束 · 已忽略（${error.message}）`,
        "stale",
      );
      return;
    }
    ui.renderError(snapshot, error.message);
    logActivity(snapshot.revision, `执行失败 · ${error.message}`, "stale");
    ui.toast(`执行失败：${error.message}`, true);
  }
}

function applyPreset(id, runImmediately = true) {
  const input = readInputState();
  updateReadout(input);
  if (!input.config) {
    ui.toast(input.errors[0] ?? "请先修正分桶参数", true);
    return;
  }
  state.config = input.config;
  clearTimeout(state.debounceTimer);
  const preset = createPreset(id, state.config);
  updateData(preset);
  ui.setFileName("按当前宽 × 高读取");
  markInputDirty(`加载 ${preset.label}`);
  if (runImmediately) {
    submitRun("场景切换");
  }
}

function regenerateCustomDimensions() {
  const input = readInputState();
  updateReadout(input);
  if (!input.config) {
    return;
  }
  state.config = input.config;
  const data = createCustomImage(input.width, input.height, state.config);
  updateData(data, { keepSelection: false, syncFields: false });
  ui.setFileName("按当前宽 × 高读取");
  markInputDirty("自定义尺寸");
  scheduleRun("尺寸变更");
}

function handleConfigInput() {
  const input = readInputState();
  updateReadout(input);
  if (!input.config) {
    return;
  }
  state.config = input.config;
  if (state.presetId === "random" || state.presetId === "boundaries") {
    updateData(createPreset(state.presetId, state.config));
  }
  markInputDirty("分桶参数");
  scheduleRun("参数变更");
}

async function importFloatFile(file) {
  const input = readInputState();
  updateReadout(input);
  if (!input.config) {
    ui.toast(input.errors[0] ?? "请先修正分桶参数", true);
    return;
  }
  if (input.width <= 0 || input.height <= 0) {
    ui.toast("导入 .f32 前请填写非零宽高", true);
    return;
  }
  const expectedSamples = input.width * input.height;
  if (expectedSamples > MAX_PIXELS) {
    ui.toast(`文件超过 ${MAX_PIXELS.toLocaleString("en-US")} 个样本限制`, true);
    return;
  }

  state.config = input.config;
  clearTimeout(state.debounceTimer);
  const token = state.fileReadToken + 1;
  state.fileReadToken = token;
  markInputDirty(`读取 ${file.name}`);
  const revisionAtStart = state.revision;
  try {
    const buffer = await file.arrayBuffer();
    if (token !== state.fileReadToken || revisionAtStart !== state.revision) {
      ui.toast("输入已变更，忽略过期的文件读取结果", true);
      return;
    }
    if (buffer.byteLength !== expectedSamples * 4) {
      throw new Error(
        `文件包含 ${buffer.byteLength / 4} 个 float32，但当前尺寸需要 ${expectedSamples} 个`,
      );
    }
    const view = new DataView(buffer);
    const values = new Float32Array(expectedSamples);
    for (let index = 0; index < expectedSamples; index += 1) {
      values[index] = view.getFloat32(index * 4, true);
    }
    updateData(
      {
        id: "custom",
        label: file.name,
        eyebrow: "IMPORTED FLOAT32",
        description: `${expectedSamples.toLocaleString("en-US")} 个 float32 样本 · ${input.width} × ${input.height} · 小端字节序`,
        width: input.width,
        height: input.height,
        values,
      },
      { keepSelection: false },
    );
    ui.setFileName(`${file.name} · ${expectedSamples.toLocaleString("en-US")} values`);
    submitRun("文件导入");
  } catch (error) {
    if (token === state.fileReadToken) {
      ui.toast(`导入失败：${error.message}`, true);
      logActivity(
        state.revision,
        `文件导入失败 · ${error.message}`,
        "stale",
      );
    }
  }
}

function resetConfiguration() {
  document.getElementById(fieldIds.bins).value = DEFAULT_CONFIG.bins;
  document.getElementById(fieldIds.min).value = DEFAULT_CONFIG.min;
  document.getElementById(fieldIds.max).value = DEFAULT_CONFIG.max;
  document.getElementById(fieldIds.workgroup).value =
    DEFAULT_CONFIG.workgroupSize;
  state.config = normalizeConfig(DEFAULT_CONFIG);
  updateReadout();
  if (state.presetId === "random" || state.presetId === "boundaries") {
    updateData(createPreset(state.presetId, state.config));
  }
  markInputDirty("参数已重置");
  submitRun("重置参数");
}

function bindEvents() {
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  document.getElementById("runButton").addEventListener("click", () => {
    markInputDirty("手动执行");
    submitRun("手动");
  });
  document.getElementById("resetConfig").addEventListener("click", resetConfiguration);
  document.getElementById("slowReadback").addEventListener("change", () => {
    ui.toast(
      elements.slowReadback.checked
        ? "慢回读已开启：旧版本将更容易被新输入淘汰"
        : "慢回读已关闭",
    );
  });

  document.getElementById(fieldIds.width).addEventListener("input", regenerateCustomDimensions);
  document.getElementById(fieldIds.height).addEventListener("input", regenerateCustomDimensions);
  document.getElementById(fieldIds.bins).addEventListener("input", handleConfigInput);
  document.getElementById(fieldIds.min).addEventListener("input", handleConfigInput);
  document.getElementById(fieldIds.max).addEventListener("input", handleConfigInput);
  document.getElementById(fieldIds.workgroup).addEventListener("change", handleConfigInput);

  document.getElementById("fileInput").addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) {
      importFloatFile(file);
    }
    event.target.value = "";
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      markInputDirty("快捷键执行");
      submitRun("快捷键");
    }
  });
}

function bindResizeRedraw() {
  let scheduled = false;
  const redraw = () => {
    if (scheduled || !state.data) {
      return;
    }
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ui.drawInput(currentSnapshot(state.appliedRevision ?? state.revision));
      if (state.result && state.appliedRevision !== null) {
        ui.drawCharts(
          currentSnapshot(state.appliedRevision),
          state.result,
        );
      }
    });
  };
  const observer = new ResizeObserver(redraw);
  observer.observe(elements.inputCanvas);
  observer.observe(elements.histogramCanvas);
  observer.observe(elements.cdfCanvas);
}

async function boot() {
  bindEvents();
  bindResizeRedraw();
  document.getElementById(fieldIds.workgroup).value =
    String(DEFAULT_CONFIG.workgroupSize);
  const initial = createPreset("partial", state.config);
  updateData(initial);
  updateReadout();
  markInputDirty("初始化输入快照");

  const { engine, reason } = await createGpuEngine();
  state.engine = engine;
  state.engineKind = engine ? "webgpu" : "cpu";
  state.engineReason = reason;
  if (engine) {
    ui.setEngine(engine.describe());
  } else {
    ui.setEngine({
      kind: "cpu",
      reason,
      name: "CPU fallback",
      detail: reason,
    });
    ui.toast(`WebGPU 不可用，已切换精确 CPU 仿真：${reason}`, true);
  }
  submitRun("初始化");
}

boot();
