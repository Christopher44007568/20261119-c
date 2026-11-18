(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const canvas = $("#render-canvas");
  const viewer = $("#viewer");
  const sampleCount = $("#sample-count");
  const stateLabel = $("#state-label");
  const progressLabel = $("#progress-label");
  const progressFill = $("#progress-fill");
  const elapsedLabel = $("#elapsed");
  const loading = $("#loading");
  const pauseButton = $("#pause-button");
  const pauseTitle = $("#pause-title");
  const footerStatus = $("#footer-status");
  const cameraReadout = $("#camera-readout");
  const toast = $("#toast");
  const checkpointView = $("#checkpoint-view");
  const checkpointImage = $("#checkpoint-image");
  const checkpointLabel = $("#checkpoint-label");
  const checkpointClose = $("#checkpoint-close");

  let tracer = null;
  let drag = null;
  let toastTimer = 0;
  let lastState = "";

  const FALLBACK_METRICS = {
    referenceSamples: 2048,
    resolution: [640, 400],
    checkpoints: [
      { samples: 10, rmse: 0.05526, relativeL1: 0.16678, psnr: 25.15 },
      { samples: 100, rmse: 0.01699, relativeL1: 0.05334, psnr: 35.40 },
      { samples: 1000, rmse: 0.00396, relativeL1: 0.01264, psnr: 48.05 }
    ]
  };

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1900);
  }

  function formatTime(milliseconds) {
    const total = milliseconds / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = Math.floor(total % 60);
    const tenths = Math.floor((total * 10) % 10);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  function formatSamples(value) {
    return String(value).padStart(4, "0");
  }

  function updateCameraReadout() {
    if (!tracer) return;
    const yaw = Math.round((tracer.camera.yaw * 180 / Math.PI) % 360);
    const pitch = Math.round(tracer.camera.pitch * 180 / Math.PI);
    cameraReadout.textContent = `${Math.round(tracer.camera.fov)}°  ·  ORBIT ${yaw}° / ${pitch}°`;
  }

  function handleProgress(state) {
    const percent = Math.min(100, state.samples / state.maxSamples * 100);
    sampleCount.textContent = formatSamples(state.samples);
    progressLabel.textContent = `${state.samples.toLocaleString("en-US")} / ${state.maxSamples.toLocaleString("en-US")}`;
    progressFill.style.width = `${percent}%`;
    elapsedLabel.textContent = formatTime(state.elapsed);

    const labels = {
      ready: "BUFFER CLEARED",
      accumulating: "ACCUMULATING",
      paused: "PAUSED",
      converged: "CONVERGED"
    };
    stateLabel.textContent = labels[state.state] || "ACCUMULATING";
    pauseButton.classList.toggle("paused", state.paused);
    pauseButton.setAttribute("aria-label", state.paused ? "Resume accumulation" : "Pause accumulation");
    pauseTitle.textContent = state.paused ? "Resume" : "Pause";
    footerStatus.innerHTML = state.paused
      ? "<i></i> ACCUMULATION PAUSED"
      : state.state === "converged"
        ? "<i></i> TARGET CONVERGED"
        : "<i></i> TRACING ON GPU";

    if (state.samples > 0 || state.paused) {
      canvas.classList.add("ready");
      loading.classList.add("hidden");
    }
    if (state.reason === "camera" && lastState !== "camera") {
      showToast("Camera changed · accumulation reset");
    }
    lastState = state.reason;
  }

  function handleError(error) {
    console.error(error);
    loading.classList.remove("hidden");
    loading.innerHTML = `<span class="loading-ring"></span><span>RENDERER ERROR</span><small>${String(error.message).slice(0, 120)}</small>`;
    footerStatus.innerHTML = "<i></i> RENDERER ERROR";
    $("#backend-tag").textContent = "UNAVAILABLE";
  }

  function setCheckpoint(samples) {
    const padded = String(samples).padStart(3, "0");
    checkpointImage.src = `assets/samples-${padded}.png`;
    checkpointImage.alt = `${samples} samples per pixel checkpoint`;
    checkpointLabel.textContent = `${samples.toLocaleString("en-US")} SAMPLES / PIXEL`;
    checkpointView.hidden = false;
    document.querySelectorAll(".sample-card").forEach((card) => {
      card.classList.toggle("active", Number(card.dataset.sample) === samples);
    });
  }

  function closeCheckpoint() {
    checkpointView.hidden = true;
    document.querySelectorAll(".sample-card").forEach((card) => card.classList.remove("active"));
  }

  function bindControls() {
    pauseButton.addEventListener("click", () => {
      if (!tracer) return;
      const paused = tracer.togglePause();
      showToast(paused ? "Paused · history preserved" : "Resumed from accumulated history");
    });

    $("#reset-button").addEventListener("click", () => {
      if (!tracer) return;
      tracer.restart();
      showToast("Accumulation restarted");
    });

    $("#camera-button").addEventListener("click", () => {
      if (!tracer) return;
      tracer.resetCamera();
      updateCameraReadout();
      showToast("Camera reset · sample count cleared");
    });

    document.querySelectorAll(".sample-card").forEach((card) => {
      card.addEventListener("click", () => setCheckpoint(Number(card.dataset.sample)));
    });
    checkpointClose.addEventListener("click", closeCheckpoint);

    viewer.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      drag = { x: event.clientX, y: event.clientY };
      viewer.setPointerCapture(event.pointerId);
    });

    viewer.addEventListener("pointermove", (event) => {
      if (!drag || !tracer) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag = { x: event.clientX, y: event.clientY };
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        tracer.orbit(dx, dy);
        updateCameraReadout();
      }
    });

    const endDrag = () => { drag = null; };
    viewer.addEventListener("pointerup", endDrag);
    viewer.addEventListener("pointercancel", endDrag);
    viewer.addEventListener("wheel", (event) => {
      if (!tracer) return;
      event.preventDefault();
      tracer.zoom(event.deltaY);
      updateCameraReadout();
    }, { passive: false });

    window.addEventListener("keydown", (event) => {
      if (event.code === "Space" && !event.target.closest("button, input, textarea")) {
        event.preventDefault();
        if (tracer) tracer.togglePause();
      } else if (event.key.toLowerCase() === "r") {
        if (tracer) tracer.restart();
      } else if (event.key.toLowerCase() === "c") {
        if (tracer) {
          tracer.resetCamera();
          updateCameraReadout();
        }
      } else if (event.key === "Escape") {
        closeCheckpoint();
      }
    });
  }

  function renderMetrics(data) {
    const checkpoints = data.checkpoints || [];
    if (!checkpoints.length) return;
    const first = checkpoints[0];
    const last = checkpoints[checkpoints.length - 1];

    for (const checkpoint of checkpoints) {
      const cardError = document.querySelector(`[data-error-for="${checkpoint.samples}"]`);
      if (cardError) cardError.textContent = `Δ ${(checkpoint.relativeL1 * 100).toFixed(1)}%`;
      const row = document.querySelector(`[data-metric-row="${checkpoint.samples}"]`);
      if (row) {
        row.querySelector("b").textContent = checkpoint.rmse.toFixed(4);
        row.querySelector("em").textContent = `${(checkpoint.relativeL1 * 100).toFixed(1)}%`;
      }
    }

    const reduction = Math.round((1 - last.relativeL1 / first.relativeL1) * 100);
    $("#error-drop").textContent = `${reduction}% LOWER`;
    $("#metric-method").textContent = "LINEAR L1";

    const values = checkpoints.map((point) => point.relativeL1);
    const maximum = Math.max(...values);
    const points = values.map((value, index) => {
      const x = 12 + index * 128;
      const y = 10 + (1 - value / maximum) * 40;
      return [x, Number(y.toFixed(2))];
    });
    const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point[0]} ${point[1]}`).join(" ");
    $("#spark-line").setAttribute("d", line);
    $("#spark-area").setAttribute("d", `${line} L268 58 L12 58 Z`);
  }

  async function loadMetrics() {
    if (window.CONVERGENCE_METRICS) renderMetrics(window.CONVERGENCE_METRICS);
    try {
      const response = await fetch("assets/metrics.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Metrics unavailable");
      const metrics = await response.json();
      renderMetrics(metrics);
      if (window.__LUMEN__) window.__LUMEN__.metrics = metrics;
    } catch (error) {
      if (!window.CONVERGENCE_METRICS) renderMetrics(FALLBACK_METRICS);
    }
  }

  try {
    tracer = new window.PathTracer(canvas, {
      maxSamples: 1000,
      onProgress: handleProgress,
      onError: handleError
    });
    bindControls();
    updateCameraReadout();
    loadMetrics();
    $("#backend-tag").textContent = tracer.floatTargets ? "WEBGL2 · FP32" : "WEBGL2";
    window.__LUMEN__ = {
      tracer,
      metrics: window.CONVERGENCE_METRICS || FALLBACK_METRICS,
      showCheckpoint: setCheckpoint,
      closeCheckpoint
    };
  } catch (error) {
    handleError(error);
  }
})();
