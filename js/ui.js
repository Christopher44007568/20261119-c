import {
  QUANTILE_LABELS,
  binInterval,
  binMidpoint,
} from "./core.js";
import { drawCdf, drawHistogram, drawInputPreview } from "./charts.js";

const byId = (id) => document.getElementById(id);

function formatInt(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  return Number(value).toLocaleString("en-US");
}

function formatValue(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return Number(value).toFixed(digits);
}

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;
}

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function sum(values) {
  let total = 0;
  for (const value of values) {
    total += value >>> 0;
  }
  return total;
}

function differenceCount(left, right) {
  if (!left || !right || left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }
  let differences = 0;
  for (let index = 0; index < left.length; index += 1) {
    if ((left[index] >>> 0) !== (right[index] >>> 0)) {
      differences += 1;
    }
  }
  return differences;
}

function heatColor(value, maximum, special = false) {
  if (value === 0) {
    return "rgba(8, 15, 20, 0.92)";
  }
  const ratio = Math.sqrt(value / Math.max(1, maximum));
  if (special) {
    return `rgba(255, 118, 152, ${0.1 + ratio * 0.34})`;
  }
  return `rgba(45, 184, 160, ${0.055 + ratio * 0.5})`;
}

const elements = {
  engineDot: byId("engineDot"),
  engineLabel: byId("engineLabel"),
  engineSmall: byId("engineSmall"),
  inputVersionTop: byId("inputVersionTop"),
  currentVersionLabel: byId("currentVersionLabel"),
  appliedVersionLabel: byId("appliedVersionLabel"),
  activityLog: byId("activityLog"),
  pendingBanner: byId("pendingBanner"),
  pendingText: byId("pendingText"),
  pendingVersion: byId("pendingVersion"),
  presetEyebrow: byId("presetEyebrow"),
  presetTitle: byId("presetTitle"),
  presetDescription: byId("presetDescription"),
  heroVersion: byId("heroVersion"),
  inputCanvas: byId("inputCanvas"),
  previewEmpty: byId("previewEmpty"),
  previewWidth: byId("previewWidth"),
  previewHeight: byId("previewHeight"),
  statSamples: byId("statSamples"),
  statValid: byId("statValid"),
  statNan: byId("statNan"),
  statOut: byId("statOut"),
  parityCard: byId("parityCard"),
  parityBadge: byId("parityBadge"),
  parityStatus: byId("parityStatus"),
  paritySub: byId("paritySub"),
  parityChecks: byId("parityChecks"),
  parityDiff: byId("parityDiff"),
  globalTime: byId("globalTime"),
  globalTotal: byId("globalTotal"),
  globalPeak: byId("globalPeak"),
  globalGroups: byId("globalGroups"),
  localTime: byId("localTime"),
  localTotal: byId("localTotal"),
  localLast: byId("localLast"),
  mergeDelta: byId("mergeDelta"),
  distributionVersion: byId("distributionVersion"),
  histogramCanvas: byId("histogramCanvas"),
  chartEmpty: byId("chartEmpty"),
  histogramFootnote: byId("histogramFootnote"),
  localGroupMeta: byId("localGroupMeta"),
  localVersion: byId("localVersion"),
  localTable: byId("localTable"),
  mergedVector: byId("mergedVector"),
  mergedCompare: byId("mergedCompare"),
  heatMax: byId("heatMax"),
  quantileVersion: byId("quantileVersion"),
  cdfCanvas: byId("cdfCanvas"),
  cdfMinLabel: byId("cdfMinLabel"),
  cdfMaxLabel: byId("cdfMaxLabel"),
  quantileRows: byId("quantileRows"),
  quantileStatus: byId("quantileStatus"),
  footerEngine: byId("footerEngine"),
  toast: byId("toast"),
  rangeReadout: byId("rangeReadout"),
  binWidthReadout: byId("binWidthReadout"),
  configError: byId("configError"),
  runButton: byId("runButton"),
  fileName: byId("fileName"),
  slowReadback: byId("slowReadback"),
};

let toastTimer = 0;

export const ui = {
  elements,

  setEngine(engineState) {
    const { kind, name, detail, reason } = engineState;
    elements.engineDot.className = "status-dot";
    if (kind === "webgpu") {
      elements.engineDot.classList.add("is-ready");
      elements.engineLabel.textContent = "WEBGPU READY";
      elements.engineSmall.textContent = name;
      elements.footerEngine.textContent = `engine: webgpu · ${name}`;
      elements.engineSmall.title = detail || name;
      elements.runButton.querySelector("strong").textContent = "运行 GPU 实验";
      elements.runButton.querySelector("small").textContent =
        "全局 / 局部双内核 · CPU 校验";
      return;
    }
    elements.engineDot.classList.add("is-error");
    elements.engineLabel.textContent = "CPU FALLBACK";
    elements.engineSmall.textContent = "WebGPU 不可用 · 精确 CPU 仿真";
    elements.engineSmall.title = reason || "";
    elements.footerEngine.textContent = "engine: cpu fallback · parity model";
    elements.runButton.querySelector("strong").textContent = "运行精确仿真";
    elements.runButton.querySelector("small").textContent =
      "WebGPU 不可用 · 同构 CPU 参考";
  },

  updateReadout(config) {
    if (!config) {
      return;
    }
    elements.rangeReadout.textContent =
      `[${formatValue(config.min, 3)}, ${formatValue(config.max, 3)}]`;
    const width = (config.max - config.min) / config.bins;
    elements.binWidthReadout.textContent =
      `${config.bins} bins · width ${width.toFixed(4)}`;
  },

  setConfigError(messages) {
    elements.configError.textContent = messages.join("；");
    elements.runButton.disabled = messages.length > 0;
  },

  setFileName(name) {
    elements.fileName.textContent = name;
  },

  renderActivity(entries) {
    if (entries.length === 0) {
      elements.activityLog.innerHTML =
        '<li class="is-muted"><time>—</time><span>等待第一次实验</span></li>';
      return;
    }
    elements.activityLog.innerHTML = entries
      .slice(0, 7)
      .map(
        (entry) =>
          `<li class="${entry.type === "stale" ? "is-stale" : ""}">` +
          `<time>v${pad(entry.revision)}</time><span>${entry.text}</span></li>`,
      )
      .join("");
  },

  renderInput(snapshot, reference = null) {
    elements.presetEyebrow.textContent =
      snapshot.eyebrow ?? snapshot.presetEyebrow ?? "CUSTOM INPUT";
    elements.presetTitle.textContent = snapshot.label ?? "自定义图像";
    elements.presetDescription.textContent =
      snapshot.description ?? "自定义 float32 图像数据。";
    elements.previewWidth.textContent = formatInt(snapshot.width);
    elements.previewHeight.textContent = formatInt(snapshot.height);
    elements.heroVersion.textContent = `INPUT v${pad(snapshot.revision)}`;
    elements.previewEmpty.hidden =
      snapshot.width > 0 && snapshot.height > 0 && snapshot.values.length > 0;
    drawInputPreview(elements.inputCanvas, snapshot, snapshot.config);
    if (reference) {
      this.renderInputStats(reference);
      elements.histogramFootnote.textContent =
        reference.lastGroupSize && reference.count > 0
          ? `${reference.workgroups} 组 × ${snapshot.config.workgroupSize} 线程 · 末组 ${reference.lastGroupSize} 个有效样本`
          : "范围端点：最小值归入首桶，最大值归入末桶。";
    }
  },

  renderInputStats(reference) {
    elements.statSamples.textContent = formatInt(reference.count);
    elements.statValid.textContent = formatInt(reference.validCount);
    elements.statNan.textContent = formatInt(reference.nanCount);
    elements.statOut.textContent = formatInt(reference.outOfRangeCount);
  },

  renderPending(snapshot, reference, phaseLabel) {
    const version = snapshot.revision;
    elements.pendingBanner.hidden = false;
    elements.pendingText.textContent = `${phaseLabel} · 输入 v${pad(version)}`;
    elements.pendingVersion.textContent = `PENDING v${pad(version)}`;
    elements.inputVersionTop.textContent = `v${pad(version)}`;
    elements.currentVersionLabel.textContent = `v${pad(version)}`;
    elements.appliedVersionLabel.textContent = "v—";
    elements.distributionVersion.textContent = `v${pad(version)} · PENDING`;
    elements.localVersion.textContent = `v${pad(version)} · PENDING`;
    elements.quantileVersion.textContent = `v${pad(version)} · PENDING`;

    this.renderInput(snapshot, reference);
    this.renderInputStats(
      reference ?? {
        count: snapshot.values.length,
        validCount: null,
        nanCount: null,
        outOfRangeCount: null,
      },
    );

    elements.parityCard.classList.remove("is-pass", "is-fail");
    elements.parityBadge.className = "parity-badge is-idle";
    elements.parityBadge.textContent = "PENDING";
    elements.parityStatus.textContent = "等待当前版本";
    elements.paritySub.textContent =
      "旧结果已隐藏；回读完成后仅接受匹配的输入版本。";
    elements.parityChecks.innerHTML =
      '<div class="check-row is-idle"><span>GPU 原子 / 局部桶 / CDF</span><code>回读中</code></div>';
    elements.parityDiff.textContent = "Δ —";

    elements.globalTime.textContent = "— ms";
    elements.localTime.textContent = "— ms";
    for (const node of [
      elements.globalTotal,
      elements.globalPeak,
      elements.globalGroups,
      elements.localTotal,
      elements.localLast,
      elements.mergeDelta,
    ]) {
      node.textContent = "—";
    }

    elements.chartEmpty.hidden = false;
    elements.chartEmpty.innerHTML =
      '<span class="pending-spinner"></span><strong>等待当前版本结果</strong>';
    elements.localGroupMeta.textContent = "— × —";
    elements.localTable.innerHTML =
      '<thead><tr><th>WORKGROUP</th></tr></thead>' +
      '<tbody><tr><td class="placeholder-cell">等待 GPU 局部桶回读</td></tr></tbody>';
    elements.mergedVector.innerHTML =
      '<span class="is-empty">等待归并向量</span>';
    elements.mergedCompare.textContent = "—";
    elements.heatMax.textContent = "—";
    elements.quantileRows.innerHTML =
      '<tr class="placeholder-row"><td colspan="4">等待当前版本 GPU 分位点</td></tr>';
    elements.quantileStatus.textContent = "PENDING";
    elements.quantileStatus.className = "";
  },

  renderError(snapshot, message) {
    elements.pendingBanner.hidden = false;
    elements.pendingText.textContent = `输入 v${pad(snapshot.revision)} · 计算失败`;
    elements.pendingVersion.textContent = `ERROR v${pad(snapshot.revision)}`;
    elements.parityCard.classList.remove("is-pass");
    elements.parityCard.classList.add("is-fail");
    elements.parityBadge.className = "parity-badge is-fail";
    elements.parityBadge.textContent = "ERROR";
    elements.parityStatus.textContent = "执行失败";
    elements.paritySub.textContent = message;
    elements.parityDiff.textContent = "Δ —";
    elements.quantileStatus.textContent = "ERROR";
    elements.quantileStatus.className = "";
  },

  toast(message, isError = false) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.className = `toast is-visible${isError ? " is-error" : ""}`;
    toastTimer = setTimeout(() => {
      elements.toast.className = "toast";
    }, 2600);
  },

  drawCharts(snapshot, result) {
    drawHistogram(elements.histogramCanvas, result, snapshot.config);
    drawCdf(elements.cdfCanvas, result, snapshot.config);
  },

  drawInput(snapshot) {
    drawInputPreview(elements.inputCanvas, snapshot, snapshot.config);
  },

  renderResults(snapshot, reference, result, comparison, engineKind) {
    const version = snapshot.revision;
    const config = snapshot.config;
    elements.pendingBanner.hidden = true;
    elements.inputVersionTop.textContent = `v${pad(version)}`;
    elements.currentVersionLabel.textContent = `v${pad(version)}`;
    elements.appliedVersionLabel.textContent = `v${pad(version)}`;
    elements.distributionVersion.textContent = `v${pad(version)} · GPU`;
    elements.localVersion.textContent = `v${pad(version)} · MERGED`;
    elements.quantileVersion.textContent = `v${pad(version)} · CDF`;
    this.renderInput(snapshot, reference);
    this.renderInputStats(reference);

    const parityRows = comparison.checks.map((check) => {
      const status = check.pass
        ? "PASS · Δ 0"
        : `FAIL · Δ ${formatInt(check.differences)}`;
      return (
        `<div class="check-row${check.pass ? "" : " is-fail"}">` +
        `<span>${check.label}</span><code>${status}</code></div>`
      );
    });
    const failedSpecial = comparison.specialChecks.filter(
      (check) => !check.pass,
    ).length;
    parityRows.push(
      `<div class="check-row${failedSpecial ? " is-fail" : ""}">` +
        `<span>NaN / 越界 / 样本总数</span>` +
        `<code>${failedSpecial ? `FAIL · ${failedSpecial} 项` : "PASS · 3/3"}</code></div>`,
    );
    elements.parityChecks.innerHTML = parityRows.join("");
    elements.parityCard.classList.toggle("is-pass", comparison.allPass);
    elements.parityCard.classList.toggle("is-fail", !comparison.allPass);
    elements.parityBadge.className =
      `parity-badge ${comparison.allPass ? "is-pass" : "is-fail"}`;
    elements.parityBadge.textContent = comparison.allPass ? "PASS" : "FAIL";
    elements.parityStatus.textContent = comparison.allPass
      ? "逐位一致"
      : "存在差异";
    elements.paritySub.textContent = comparison.allPass
      ? `${comparison.checks.length} 项数组与 3 项特殊计数均为 0 差异。`
      : "GPU 计数与 CPU float32 参考不一致，请检查内核配置。";
    elements.parityDiff.textContent = `Δ ${
      Number.isFinite(comparison.totalDifference)
        ? formatInt(comparison.totalDifference)
        : "—"
    }`;

    const globalTotal = sum(result.globalHistogram);
    let peakIndex = 0;
    let peakCount = 0;
    for (let bin = 0; bin < config.bins; bin += 1) {
      if (result.globalHistogram[bin] > peakCount) {
        peakCount = result.globalHistogram[bin];
        peakIndex = bin;
      }
    }
    const localTotal = sum(result.mergedHistogram);
    const mergeDiff = differenceCount(
      result.globalHistogram,
      result.mergedHistogram,
    );
    elements.globalTime.textContent = formatMs(result.timing?.totalMs);
    elements.localTime.textContent = formatMs(result.timing?.totalMs);
    elements.globalTotal.textContent = formatInt(globalTotal);
    elements.globalPeak.textContent = peakCount
      ? `B${pad(peakIndex)} · ${formatInt(peakCount)}`
      : "—";
    elements.globalGroups.textContent = formatInt(reference.workgroups);
    elements.localTotal.textContent = formatInt(localTotal);
    elements.localLast.textContent = reference.workgroups
      ? `${formatInt(reference.lastGroupSize)}/${config.workgroupSize}`
      : "—";
    elements.mergeDelta.textContent = Number.isFinite(mergeDiff)
      ? `Δ ${formatInt(mergeDiff)}`
      : "—";
    if (engineKind === "cpu") {
      elements.globalTime.title = "CPU fallback 总耗时（含模拟回读）";
      elements.localTime.title = "CPU fallback 总耗时（含模拟回读）";
    }

    elements.chartEmpty.hidden = true;
    this.drawCharts(snapshot, result);
    elements.histogramFootnote.textContent =
      reference.count > 0
        ? `有效 ${formatInt(reference.validCount)} · NaN ${formatInt(
            reference.nanCount,
          )} · 越界 ${formatInt(reference.outOfRangeCount)}；CDF 仅含有效桶。`
        : "空图：0 个样本，所有桶、CDF 与分位点均为空。";

    this.renderLocalBuckets(reference, result);
    this.renderQuantiles(snapshot, reference, result, comparison);
  },

  renderLocalBuckets(reference, result) {
    const bins = reference.config.bins;
    const width = bins + 2;
    const workgroups = reference.workgroups;
    const mergeDiff = differenceCount(
      result.globalHistogram,
      result.mergedHistogram,
    );
    elements.localGroupMeta.textContent =
      `${formatInt(workgroups)} groups × ${formatInt(width)} counters · WG ${reference.config.workgroupSize}`;
    elements.mergedCompare.textContent = Number.isFinite(mergeDiff)
      ? `Δ ${formatInt(mergeDiff)} · ${mergeDiff === 0 ? "PASS" : "FAIL"}`
      : "—";

    let maximum = 0;
    for (const value of result.localHistogram) {
      maximum = Math.max(maximum, value >>> 0);
    }
    elements.heatMax.textContent = formatInt(maximum);

    elements.mergedVector.innerHTML = Array.from(
      result.mergedHistogram,
      (count, index) => {
        const special = index >= bins;
        const label = special
          ? index === bins
            ? "N"
            : "O"
          : pad(index);
        return (
          `<span class="${special ? "is-special" : ""}" ` +
          `title="${special ? (index === bins ? "NaN" : "越界") : `桶 ${index}`}: ${formatInt(count)}">` +
          `<i>${label}</i><b>${formatInt(count)}</b></span>`
        );
      },
    ).join("");

    if (workgroups === 0) {
      elements.localTable.innerHTML =
        `<thead><tr><th>WORKGROUP</th>${buildBucketHeaders(bins)}</tr></thead>` +
        '<tbody><tr><td class="placeholder-cell" colspan="' +
        (width + 1) +
        '">空图 · 0 个工作组，归并向量全零</td></tr></tbody>';
      return;
    }

    const visibleGroups = Math.min(workgroups, 512);
    const rows = [];
    for (let group = 0; group < visibleGroups; group += 1) {
      const groupStart = group * reference.config.workgroupSize;
      const occupancy =
        reference.count === 0
          ? 0
          : Math.min(
              reference.config.workgroupSize,
              reference.count - groupStart,
            );
      const cells = [];
      for (let bin = 0; bin < width; bin += 1) {
        const resultIndex = group * width + bin;
        const value = result.localHistogram[resultIndex] >>> 0;
        const expected = reference.localHistogram[resultIndex] >>> 0;
        const special = bin >= bins;
        const classes = [
          special ? "is-special" : "",
          value === 0 ? "is-zero" : "",
          value !== expected ? "is-mismatch" : "",
        ]
          .filter(Boolean)
          .join(" ");
        cells.push(
          `<td class="${classes}" style="background:${heatColor(
            value,
            maximum,
            special,
          )}" title="WG ${pad(group)} / bin ${bin}: ${formatInt(value)}">` +
            `${value === 0 ? "·" : formatInt(value)}</td>`,
        );
      }
      rows.push(
        `<tr><td title="组内有效样本 ${formatInt(occupancy)}">WG ${pad(
          group,
        )}${group === workgroups - 1 && occupancy < reference.config.workgroupSize ? "*" : ""}</td>` +
          `${cells.join("")}</tr>`,
      );
    }
    if (workgroups > visibleGroups) {
      rows.push(
        `<tr><td>…</td><td colspan="${width}">另有 ${formatInt(
          workgroups - visibleGroups,
        )} 个工作组未展开（仅影响可视化）</td></tr>`,
      );
    }
    elements.localTable.innerHTML =
      `<thead><tr><th>WORKGROUP</th>${buildBucketHeaders(bins)}</tr></thead>` +
      `<tbody>${rows.join("")}</tbody>`;
  },

  renderQuantiles(snapshot, reference, result, comparison) {
    const config = snapshot.config;
    const valid = result.localCdf[config.bins - 1] >>> 0;
    elements.cdfMinLabel.textContent = formatValue(config.min, 3);
    elements.cdfMaxLabel.textContent = formatValue(config.max, 3);
    elements.quantileRows.innerHTML = result.localQuantileBins
      .map((bin, index) => {
        const expected = reference.quantileBins[index];
        if (bin === null || bin === undefined) {
          return (
            `<tr><td>${QUANTILE_LABELS[index]}</td><td class="is-muted">—</td>` +
            '<td class="is-muted">—</td><td class="is-muted">0.00%</td></tr>'
          );
        }
        const interval = binInterval(bin, config);
        const midpoint = binMidpoint(bin, config);
        const cumulative = result.localCdf[bin] >>> 0;
        const percent = valid ? (cumulative / valid) * 100 : 0;
        const mismatch = bin !== expected ? ' class="is-mismatch"' : "";
        return (
          `<tr${mismatch}><td>${QUANTILE_LABELS[index]}</td>` +
          `<td>B${pad(bin)} <span class="is-muted">[${formatValue(
            interval.low,
            3,
          )}, ${formatValue(interval.high, 3)}]</span></td>` +
          `<td>${formatValue(midpoint, 4)}</td>` +
          `<td>${percent.toFixed(1)}%</td></tr>`
        );
      })
      .join("");

    const quantilePass =
      comparison.checks.find((check) => check.id === "localQuantiles")
        ?.pass ?? false;
    elements.quantileStatus.textContent = quantilePass
      ? "PASS · CDF 二分一致"
      : "FAIL · 分位桶不一致";
    elements.quantileStatus.className = quantilePass ? "is-pass" : "";
  },
};

function buildBucketHeaders(bins) {
  const labels = [];
  for (let bin = 0; bin < bins; bin += 1) {
    labels.push(`<th scope="col">B${pad(bin)}</th>`);
  }
  labels.push('<th scope="col" class="is-special-head">NaN</th>');
  labels.push('<th scope="col" class="is-special-head">OOB</th>');
  return labels.join("");
}
