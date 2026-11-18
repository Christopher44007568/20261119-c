(function () {
  "use strict";

  const P = window.ThinFilmPhysics;
  const $ = (selector) => document.querySelector(selector);
  const DENSITIES = [16, 31, 61, 121, 241, 481];
  const state = {
    thickness: 320,
    nFilm: 2,
    angle: 25,
    sampleCount: 241,
  };

  const elements = {
    thicknessRange: $("#thicknessRange"),
    thicknessNumber: $("#thicknessNumber"),
    indexRange: $("#indexRange"),
    indexNumber: $("#indexNumber"),
    angleRange: $("#angleRange"),
    angleNumber: $("#angleNumber"),
    sampleSelect: $("#sampleSelect"),
    stackFilmIndex: $("#stackFilmIndex"),
    filmDisc: $("#filmDisc"),
    hexPill: $("#hexPill"),
    angleTag: $("#angleTag"),
    avgMetric: $("#avgMetric"),
    luminanceMetric: $("#luminanceMetric"),
    peakMetric: $("#peakMetric"),
    peakStrip: $("#peakStrip"),
    shiftSummary: $("#shiftSummary"),
    spectrumCanvas: $("#spectrumCanvas"),
    spectrumTooltip: $("#spectrumTooltip"),
    heatmapCanvas: $("#heatmapCanvas"),
    checkList: $("#checkList"),
    passPill: $("#passPill"),
    rerunChecks: $("#rerunChecks"),
    samplingBars: $("#samplingBars"),
    sampleSwatch: $("#sampleSwatch"),
    referenceSwatch: $("#referenceSwatch"),
  };

  let lastSpectrum = null;
  let spectrumPlot = null;
  let renderFrame = 0;
  let analysisTimer = 0;
  let analysisGeneration = 0;

  function formatInteger(value) {
    return String(Math.round(value));
  }

  function formatIndex(value) {
    return Number(value).toFixed(2);
  }

  function formatAngle(value) {
    return Number(value).toFixed(1);
  }

  function setRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const percentage = ((value - min) / (max - min)) * 100;
    input.style.setProperty("--fill", `${P.clamp(percentage, 0, 100)}%`);
  }

  function syncControls() {
    elements.thicknessRange.value = String(state.thickness);
    elements.thicknessNumber.value = formatInteger(state.thickness);
    elements.indexRange.value = String(state.nFilm);
    elements.indexNumber.value = formatIndex(state.nFilm);
    elements.angleRange.value = String(state.angle);
    elements.angleNumber.value = formatAngle(state.angle);
    elements.stackFilmIndex.textContent = Number(state.nFilm).toFixed(3);
    [elements.thicknessRange, elements.indexRange, elements.angleRange].forEach(setRangeFill);
  }

  function scheduleRender() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      render();
    });
  }

  function scheduleAnalysis(delay) {
    window.clearTimeout(analysisTimer);
    const generation = ++analysisGeneration;
    analysisTimer = window.setTimeout(() => {
      if (generation !== analysisGeneration) return;
      runAnalysis();
    }, delay == null ? 120 : delay);
  }

  function updateState(patch, options) {
    const sync = !options || options.sync !== false;
    Object.assign(state, patch);
    if (sync) syncControls();
    scheduleRender();
    scheduleAnalysis();
  }

  function setDiscColor(color) {
    const { r, g, b } = color.rgb255;
    elements.filmDisc.style.backgroundColor = color.hex;
    elements.filmDisc.style.boxShadow = [
      "0 0 0 8px rgba(255,255,255,0.018)",
      `0 0 68px rgba(${r}, ${g}, ${b}, 0.28)`,
      "inset 0 0 42px rgba(255,255,255,0.07)",
    ].join(", ");
  }

  function peakLabel(peak) {
    return `${Math.round(peak.wavelength)} nm · ${(peak.reflectance * 100).toFixed(1)}%`;
  }

  function renderPeakStrip(peaks) {
    if (!peaks.length) {
      elements.peakStrip.innerHTML = '<span class="peak-empty">连续谱段 · 无可见局部峰</span>';
      return;
    }
    elements.peakStrip.innerHTML = peaks
      .map((peak) => `<span>λ ${peakLabel(peak)}</span>`)
      .join("");
  }

  function updateShiftSummary(currentPeaks, normalPeaks) {
    if (!currentPeaks.length) {
      elements.shiftSummary.textContent = "当前角度无可见局部峰";
      return;
    }
    if (!normalPeaks.length) {
      const currentMain = currentPeaks.reduce((a, b) => (
        a.reflectance >= b.reflectance ? a : b
      ));
      elements.shiftSummary.textContent = `最强峰 ${Math.round(currentMain.wavelength)} nm`;
      return;
    }
    const normalMain = normalPeaks.reduce((a, b) => (
      a.reflectance >= b.reflectance ? a : b
    ));
    let tracked = currentPeaks[0];
    let distance = Math.abs(tracked.wavelength - normalMain.wavelength);
    for (let index = 1; index < currentPeaks.length; index += 1) {
      const candidateDistance = Math.abs(currentPeaks[index].wavelength - normalMain.wavelength);
      if (candidateDistance < distance) {
        tracked = currentPeaks[index];
        distance = candidateDistance;
      }
    }
    const shift = tracked.wavelength - normalMain.wavelength;
    const sign = shift >= 0 ? "+" : "−";
    elements.shiftSummary.textContent = `跟踪峰 ${Math.round(tracked.wavelength)} nm · 较法线 ${sign}${Math.abs(shift).toFixed(0)} nm`;
  }

  function renderReadouts(spectrum, color) {
    const peaks = P.detectPeaks(spectrum.wavelengths, spectrum.reflectance);
    const normalPeaks = P.detectPeaks(spectrum.wavelengths, spectrum.normal);
    const currentMain = peaks.length
      ? peaks.reduce((a, b) => (a.reflectance >= b.reflectance ? a : b))
      : null;

    elements.hexPill.textContent = color.hex.toUpperCase();
    elements.angleTag.textContent = `${state.angle.toFixed(1)}° 观察`;
    elements.avgMetric.textContent = `${(color.averageReflectance * 100).toFixed(1)}%`;
    elements.luminanceMetric.textContent = `${(color.luminance * 100).toFixed(1)}%`;
    elements.peakMetric.textContent = currentMain
      ? `${Math.round(currentMain.wavelength)} nm`
      : "连续谱";
    renderPeakStrip(peaks);
    updateShiftSummary(peaks, normalPeaks);
    setDiscColor(color);
  }

  function render() {
    const spectrum = P.sampleSpectrum({
      thickness: state.thickness,
      nFilm: state.nFilm,
      angle: state.angle,
      count: state.sampleCount,
      includeNormal: true,
    });
    const color = P.colorFromSpectrum(spectrum);
    lastSpectrum = spectrum;
    renderReadouts(spectrum, color);
    drawSpectrum(spectrum);
    drawHeatmap();
  }

  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context, width, height };
  }

  let spectrumBand = null;
  function getSpectrumBand() {
    if (!spectrumBand) {
      spectrumBand = P.linspace(P.LAMBDA_MIN, P.LAMBDA_MAX, 400).map(P.wavelengthCss);
    }
    return spectrumBand;
  }

  function drawSpectrum(spectrum) {
    const { context, width, height } = prepareCanvas(elements.spectrumCanvas);
    if (width < 80 || height < 60) return;

    const left = 38;
    const right = width - 13;
    const top = 14;
    const bottom = height - 27;
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    if (plotWidth <= 10 || plotHeight <= 10) return;

    let observedMax = 0;
    for (let index = 0; index < spectrum.reflectance.length; index += 1) {
      observedMax = Math.max(
        observedMax,
        spectrum.reflectance[index],
        spectrum.normal[index],
      );
    }
    const yMax = P.clamp(Math.ceil(observedMax * 1.18 * 10) / 10, 0.2, 1);
    const xForWavelength = (wavelength) => (
      left + ((wavelength - P.LAMBDA_MIN) / (P.LAMBDA_MAX - P.LAMBDA_MIN)) * plotWidth
    );
    const yForReflectance = (value) => bottom - (value / yMax) * plotHeight;

    spectrumPlot = {
      left,
      right,
      top,
      bottom,
      width: plotWidth,
      height: plotHeight,
      yMax,
    };

    context.save();
    context.font = '8px "SFMono-Regular", Consolas, monospace';
    context.lineWidth = 1;

    for (let index = 0; index <= 4; index += 1) {
      const ratio = index / 4;
      const y = bottom - ratio * plotHeight;
      context.strokeStyle = "rgba(173, 210, 201, 0.085)";
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
      context.fillStyle = "#607874";
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(`${Math.round(yMax * ratio * 100)}%`, left - 8, y);
    }

    const xTicks = [400, 500, 600, 700, 780];
    context.textAlign = "center";
    context.textBaseline = "top";
    xTicks.forEach((wavelength) => {
      const x = xForWavelength(wavelength);
      context.strokeStyle = "rgba(173, 210, 201, 0.06)";
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
      context.fillStyle = "#607874";
      context.fillText(String(wavelength), x, bottom + 8);
    });

    context.fillStyle = "#607874";
    context.textAlign = "left";
    context.fillText("R", left - 2, 1);
    context.textAlign = "right";
    context.fillText("λ / nm", right, bottom + 8);

    const band = getSpectrumBand();
    for (let x = Math.floor(left); x < right; x += 2) {
      const ratio = (x - left) / plotWidth;
      const colorIndex = Math.min(band.length - 1, Math.max(0, Math.round(ratio * (band.length - 1))));
      context.fillStyle = band[colorIndex];
      context.fillRect(x, height - 4, 2, 2);
    }

    const areaGradient = context.createLinearGradient(0, top, 0, bottom);
    areaGradient.addColorStop(0, "rgba(126, 219, 208, 0.18)");
    areaGradient.addColorStop(1, "rgba(126, 219, 208, 0.01)");
    context.beginPath();
    spectrum.wavelengths.forEach((wavelength, index) => {
      const x = xForWavelength(wavelength);
      const y = yForReflectance(spectrum.reflectance[index]);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineTo(right, bottom);
    context.lineTo(left, bottom);
    context.closePath();
    context.fillStyle = areaGradient;
    context.fill();

    context.strokeStyle = "rgba(231, 177, 121, 0.72)";
    context.lineWidth = 1.15;
    context.beginPath();
    spectrum.wavelengths.forEach((wavelength, index) => {
      const x = xForWavelength(wavelength);
      const y = yForReflectance(spectrum.normal[index]);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();

    context.strokeStyle = "#7edbd0";
    context.lineWidth = 1.8;
    context.shadowColor = "rgba(126, 219, 208, 0.34)";
    context.shadowBlur = 6;
    context.beginPath();
    spectrum.wavelengths.forEach((wavelength, index) => {
      const x = xForWavelength(wavelength);
      const y = yForReflectance(spectrum.reflectance[index]);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    context.shadowBlur = 0;

    if (spectrum.count <= 61) {
      context.fillStyle = "#b8eee6";
      spectrum.wavelengths.forEach((wavelength, index) => {
        const x = xForWavelength(wavelength);
        const y = yForReflectance(spectrum.reflectance[index]);
        context.beginPath();
        context.arc(x, y, 1.7, 0, Math.PI * 2);
        context.fill();
      });
    }

    const peaks = P.detectPeaks(spectrum.wavelengths, spectrum.reflectance);
    context.fillStyle = "#e7b179";
    peaks.forEach((peak) => {
      const x = xForWavelength(peak.wavelength);
      const y = yForReflectance(peak.reflectance);
      context.beginPath();
      context.arc(x, y, 2.4, 0, Math.PI * 2);
      context.fill();
    });

    context.strokeStyle = "rgba(173, 210, 201, 0.17)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, bottom);
    context.lineTo(right, bottom);
    context.stroke();
    context.restore();
  }

  const HEAT_STOPS = [
    { at: 0.0, color: [7, 12, 28] },
    { at: 0.12, color: [30, 38, 78] },
    { at: 0.3, color: [87, 54, 100] },
    { at: 0.5, color: [154, 71, 85] },
    { at: 0.7, color: [218, 119, 75] },
    { at: 0.86, color: [245, 187, 96] },
    { at: 1.0, color: [255, 245, 210] },
  ];

  const heatLut = (() => {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let index = 0; index < 256; index += 1) {
      const value = index / 255;
      let upper = 1;
      while (upper < HEAT_STOPS.length - 1 && HEAT_STOPS[upper].at < value) upper += 1;
      const lower = Math.max(0, upper - 1);
      const span = HEAT_STOPS[upper].at - HEAT_STOPS[lower].at || 1;
      const mix = P.clamp((value - HEAT_STOPS[lower].at) / span, 0, 1);
      for (let channel = 0; channel < 3; channel += 1) {
        const start = HEAT_STOPS[lower].color[channel];
        const end = HEAT_STOPS[upper].color[channel];
        lut[index * 3 + channel] = Math.round(start + (end - start) * mix);
      }
    }
    return lut;
  })();

  let heatBuffer = document.createElement("canvas");
  let heatBufferContext = heatBuffer.getContext("2d");

  function drawHeatmap() {
    const { context, width, height } = prepareCanvas(elements.heatmapCanvas);
    if (width < 80 || height < 60) return;

    const left = 36;
    const right = width - 12;
    const top = 12;
    const bottom = height - 27;
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    if (plotWidth <= 10 || plotHeight <= 10) return;

    const gridWidth = Math.max(150, Math.min(360, Math.round(plotWidth * 0.72)));
    const gridHeight = Math.max(80, Math.min(210, Math.round(plotHeight * 0.72)));
    if (heatBuffer.width !== gridWidth || heatBuffer.height !== gridHeight) {
      heatBuffer.width = gridWidth;
      heatBuffer.height = gridHeight;
      heatBufferContext = heatBuffer.getContext("2d");
    }
    const image = heatBufferContext.createImageData(gridWidth, gridHeight);
    const data = image.data;
    const reflectanceGrid = new Float32Array(gridWidth * gridHeight);

    for (let row = 0; row < gridHeight; row += 1) {
      const angle = 85 * (1 - (row + 0.5) / gridHeight);
      for (let column = 0; column < gridWidth; column += 1) {
        const wavelength = P.LAMBDA_MIN
          + ((column + 0.5) / gridWidth) * (P.LAMBDA_MAX - P.LAMBDA_MIN);
        const value = P.reflectanceAt(wavelength, state.thickness, state.nFilm, angle);
        reflectanceGrid[row * gridWidth + column] = value;
        const lutIndex = Math.round(P.clamp(value, 0, 1) * 255) * 3;
        const pixel = (row * gridWidth + column) * 4;
        data[pixel] = heatLut[lutIndex];
        data[pixel + 1] = heatLut[lutIndex + 1];
        data[pixel + 2] = heatLut[lutIndex + 2];
        data[pixel + 3] = 255;
      }
    }
    heatBufferContext.putImageData(image, 0, 0);

    context.save();
    context.imageSmoothingEnabled = true;
    context.drawImage(heatBuffer, left, top, plotWidth, plotHeight);

    context.font = '8px "SFMono-Regular", Consolas, monospace';
    context.lineWidth = 1;
    context.textBaseline = "middle";

    const yTicks = [0, 30, 60, 85];
    yTicks.forEach((angle) => {
      const y = top + (1 - angle / 85) * plotHeight;
      context.strokeStyle = "rgba(236, 244, 235, 0.08)";
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
      context.fillStyle = "#607874";
      context.textAlign = "right";
      context.fillText(`${angle}°`, left - 8, y);
    });

    const xTicks = [400, 500, 600, 700, 780];
    xTicks.forEach((wavelength) => {
      const x = left + ((wavelength - P.LAMBDA_MIN) / (P.LAMBDA_MAX - P.LAMBDA_MIN)) * plotWidth;
      context.strokeStyle = "rgba(236, 244, 235, 0.06)";
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
      context.fillStyle = "#607874";
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(String(wavelength), x, bottom + 8);
    });

    context.fillStyle = "#607874";
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText("θ", 3, 4);
    context.textAlign = "right";
    context.fillText("λ / nm", right, bottom + 8);

    context.fillStyle = "rgba(255, 244, 211, 0.82)";
    for (let row = 1; row < gridHeight - 1; row += 1) {
      for (let column = 1; column < gridWidth - 1; column += 1) {
        const index = row * gridWidth + column;
        const center = reflectanceGrid[index];
        const leftValue = reflectanceGrid[index - 1];
        const rightValue = reflectanceGrid[index + 1];
        if (
          center >= leftValue
          && center > rightValue
          && center > 0.03
          && center - Math.max(leftValue, rightValue) > 1e-7
        ) {
          const x = left + ((column + 0.5) / gridWidth) * plotWidth;
          const y = top + ((row + 0.5) / gridHeight) * plotHeight;
          context.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
        }
      }
    }

    const currentY = top + (1 - state.angle / 85) * plotHeight;
    context.strokeStyle = "rgba(255, 205, 146, 0.92)";
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(left, currentY);
    context.lineTo(right, currentY);
    context.stroke();
    context.setLineDash([]);

    const label = `${state.angle.toFixed(1)}°`;
    context.font = '7.5px "SFMono-Regular", Consolas, monospace';
    const textWidth = context.measureText(label).width;
    const labelY = P.clamp(currentY - 9, top + 2, bottom - 14);
    context.fillStyle = "rgba(5, 13, 16, 0.8)";
    context.fillRect(right - textWidth - 10, labelY, textWidth + 7, 13);
    context.fillStyle = "#f1c799";
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(label, right - 5, labelY + 6.5);
    context.restore();
  }

  function renderValidation(result) {
    const passed = result.checks.filter((check) => check.pass).length;
    elements.passPill.textContent = `${passed}/${result.checks.length} PASS`;
    elements.passPill.classList.toggle("fail", !result.allPass);
    elements.checkList.innerHTML = result.checks.map((check) => `
      <div class="check-row">
        <span class="check-mark">${check.pass ? "✓" : "!"}</span>
        <span class="check-copy">
          <strong>${check.label}</strong>
          <span>${check.detail}</span>
        </span>
        <span class="check-value${check.pass ? "" : " bad"}">${check.value}</span>
      </div>
    `).join("");
  }

  function formatDelta(value) {
    if (value === 0) return "0";
    if (value < 0.001) return value.toExponential(1);
    if (value < 0.1) return value.toFixed(3);
    if (value < 1) return value.toFixed(2);
    return value.toFixed(1);
  }

  function renderSampling(result) {
    const maxError = Math.max(...result.rows.map((row) => row.deltaE), 0.001);
    elements.samplingBars.innerHTML = result.rows.map((row) => {
      const width = Math.max(1.5, (row.deltaE / maxError) * 100);
      const current = row.count === state.sampleCount ? " current" : "";
      return `
        <div class="sampling-row${current}">
          <span class="density"><i></i><span>${row.count} λ</span></span>
          <span class="bar-track"><span class="bar-fill" style="width:${width.toFixed(2)}%"></span></span>
          <span class="delta">${formatDelta(row.deltaE)}</span>
          <span class="sample-chip" style="background:${row.color.hex}"></span>
        </div>
      `;
    }).join("");

    const selected = result.rows.find((row) => row.count === state.sampleCount) || result.rows[0];
    elements.sampleSwatch.style.background = selected.color.hex;
    elements.referenceSwatch.style.background = result.reference.hex;
  }

  function runAnalysis() {
    analysisTimer = 0;
    try {
      const validation = P.runValidation(state);
      renderValidation(validation);
      const sampling = P.compareSampling(state);
      renderSampling(sampling);
    } catch (error) {
      console.error("Analysis failed", error);
    }
  }

  function bindNumericControl(range, number, key, limits, formatter) {
    const commit = (rawValue, updateNumber) => {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) return;
      const clamped = P.clamp(numeric, limits.min, limits.max);
      state[key] = clamped;
      range.value = String(clamped);
      setRangeFill(range);
      if (updateNumber) number.value = formatter(clamped);
      scheduleRender();
      scheduleAnalysis();
    };

    range.addEventListener("input", () => commit(range.value, true));
    number.addEventListener("input", () => commit(number.value, false));
    number.addEventListener("blur", syncControls);
    number.addEventListener("keydown", (event) => {
      if (event.key === "Enter") number.blur();
    });
  }

  const presets = {
    mgf2: { thickness: 100, nFilm: 1.38, angle: 25 },
    soap: { thickness: 420, nFilm: 1.33, angle: 25 },
    zero: { thickness: 0 },
    normal: { angle: 0 },
  };

  function bindEvents() {
    bindNumericControl(
      elements.thicknessRange,
      elements.thicknessNumber,
      "thickness",
      { min: 0, max: 1200 },
      formatInteger,
    );
    bindNumericControl(
      elements.indexRange,
      elements.indexNumber,
      "nFilm",
      { min: 1, max: 2.5 },
      formatIndex,
    );
    bindNumericControl(
      elements.angleRange,
      elements.angleNumber,
      "angle",
      { min: 0, max: 85 },
      formatAngle,
    );

    elements.sampleSelect.addEventListener("change", () => {
      state.sampleCount = Number(elements.sampleSelect.value);
      scheduleRender();
      scheduleAnalysis(50);
    });

    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => {
        const preset = presets[button.dataset.preset];
        if (preset) updateState(preset, { sync: true });
      });
    });

    elements.rerunChecks.addEventListener("click", runAnalysis);

    elements.spectrumCanvas.addEventListener("pointermove", (event) => {
      if (!spectrumPlot || !lastSpectrum) return;
      const rect = elements.spectrumCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (x < spectrumPlot.left || x > spectrumPlot.right) {
        elements.spectrumTooltip.hidden = true;
        return;
      }
      const wavelength = P.LAMBDA_MIN
        + ((x - spectrumPlot.left) / spectrumPlot.width) * (P.LAMBDA_MAX - P.LAMBDA_MIN);
      const reflectance = P.reflectanceAt(
        wavelength,
        state.thickness,
        state.nFilm,
        state.angle,
      );
      const normal = P.reflectanceAt(wavelength, state.thickness, state.nFilm, 0);
      elements.spectrumTooltip.innerHTML = [
        `<strong>${wavelength.toFixed(0)} nm</strong>`,
        `R ${(reflectance * 100).toFixed(1)}%`,
        `法线 ${(normal * 100).toFixed(1)}%`,
      ].join("<br>");
      const tooltipLeft = P.clamp(x, 58, rect.width - 58);
      const tooltipTop = P.clamp(event.clientY - rect.top, 42, rect.height - 6);
      elements.spectrumTooltip.style.left = `${tooltipLeft}px`;
      elements.spectrumTooltip.style.top = `${tooltipTop}px`;
      elements.spectrumTooltip.hidden = false;
    });

    elements.spectrumCanvas.addEventListener("pointerleave", () => {
      elements.spectrumTooltip.hidden = true;
    });

    window.addEventListener("resize", scheduleRender);
  }

  function observeLayout() {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(scheduleRender);
    observer.observe(elements.spectrumCanvas.parentElement);
    observer.observe(elements.heatmapCanvas.parentElement);
  }

  function init() {
    bindEvents();
    observeLayout();
    syncControls();
    render();
    scheduleAnalysis(0);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(scheduleRender).catch(() => {});
    }
  }

  init();
})();
