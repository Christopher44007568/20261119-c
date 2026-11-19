import "./style.css";
import { ParticleSystem } from "./particle-system.js";

const elements = {
  activeCount: document.querySelector("#active-count"),
  activeRatio: document.querySelector("#active-ratio"),
  bufferSize: document.querySelector("#buffer-size"),
  burstButton: document.querySelector("#burst-button"),
  capacityFill: document.querySelector("#capacity-fill"),
  capacityOptions: document.querySelector("#capacity-options"),
  capacityPeak: document.querySelector("#capacity-peak"),
  clock: document.querySelector("#clock"),
  droppedCount: document.querySelector("#dropped-count"),
  frameRate: document.querySelector("#frame-rate"),
  freeCount: document.querySelector("#free-count"),
  ledgerCount: document.querySelector("#ledger-count"),
  ledgerMore: document.querySelector("#ledger-more"),
  maxGeneration: document.querySelector("#max-generation"),
  nodeA: document.querySelector("#node-a"),
  nodeB: document.querySelector("#node-b"),
  overflowToast: document.querySelector("#overflow-toast"),
  pauseButton: document.querySelector("#pause-button"),
  pauseLabel: document.querySelector("#pause-label"),
  pingDst: document.querySelector("#ping-dst"),
  pingSrc: document.querySelector("#ping-src"),
  rate: document.querySelector("#rate"),
  rateOutput: document.querySelector("#rate-output"),
  reclaimedCount: document.querySelector("#reclaimed-count"),
  simTime: document.querySelector("#sim-time"),
  slotLedger: document.querySelector("#slot-ledger"),
  stressButton: document.querySelector("#stress-button"),
  tfDraws: document.querySelector("#tf-draws"),
  webglError: document.querySelector("#webgl-error"),
  canvas: document.querySelector("#gpu-canvas"),
};

const state = {
  capacity: 4096,
  droppedSeen: 0,
  emissionAccumulator: 0,
  fps: 60,
  frameCarry: 0,
  lastFrame: performance.now(),
  lastLedgerSignature: "",
  lastUiUpdate: 0,
  overflowUntil: 0,
  paused: false,
  rate: 240,
  seenSlots: new Map(),
};

let system;

try {
  system = new ParticleSystem(elements.canvas);
  system.reset(state.capacity);
} catch (error) {
  elements.webglError.hidden = false;
  elements.webglError.querySelector("p").textContent = error.message;
  console.error(error);
}

function formatInteger(value) {
  return Math.max(0, Math.floor(value)).toString();
}

function pad(value, length = 2) {
  return formatInteger(value).padStart(length, "0");
}

function setRate(value) {
  state.rate = Number(value);
  elements.rate.value = String(state.rate);
  elements.rateOutput.innerHTML = `${state.rate} <small>/s</small>`;
  const percentage = (state.rate / Number(elements.rate.max)) * 100;
  elements.rate.style.setProperty("--fill", `${percentage}%`);
}

function showOverflow() {
  state.overflowUntil = performance.now() + 1250;
  elements.overflowToast.classList.add("visible");
}

function emit(count) {
  if (!system) return 0;
  const accepted = system.emit(count);
  if (accepted < count) showOverflow();
  return accepted;
}

function burst(count = 160) {
  if (!system) return;
  emit(count);
  elements.burstButton.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(0.97)" },
      { transform: "scale(1)" },
    ],
    { duration: 180, easing: "ease-out" },
  );
}

function setPaused(paused) {
  state.paused = paused;
  state.emissionAccumulator = 0;
  elements.pauseLabel.textContent = paused ? "RESUME" : "PAUSE";
  elements.pauseButton.classList.toggle("paused", paused);
  document.querySelector(".live-chip").lastChild.textContent = paused
    ? " HOLD"
    : " LIVE";
}

function resetSimulation(capacity = state.capacity) {
  if (!system) return;
  state.capacity = capacity;
  state.emissionAccumulator = 0;
  state.droppedSeen = 0;
  state.seenSlots.clear();
  system.reset(capacity);

  for (const button of elements.capacityOptions.querySelectorAll("button")) {
    button.classList.toggle(
      "selected",
      Number(button.dataset.capacity) === capacity,
    );
  }
  updateUi(performance.now(), true);
}

function renderLedger(entries, total) {
  const visible = entries.slice(0, 9);
  const nextSeen = new Map();
  const rows = visible.map((entry) => {
    const previousGeneration = state.seenSlots.get(entry.index);
    const isFresh =
      previousGeneration === undefined ||
      previousGeneration !== entry.generation;
    nextSeen.set(entry.index, entry.generation);

    return `<div class="slot-row${isFresh ? " fresh" : ""}">
      <span class="slot-index">#${pad(entry.index, 4)}</span>
      <span class="slot-gen">G${pad(entry.generation)}</span>
      <span class="slot-age">${entry.age.toFixed(2)}s</span>
      <span class="slot-life">${entry.remaining.toFixed(1)}s</span>
    </div>`;
  });

  state.seenSlots = nextSeen;
  elements.slotLedger.innerHTML =
    rows.join("") ||
    `<div class="slot-row"><span class="slot-index">--</span><span>--</span><span>--</span><span>--</span></div>`;
  elements.ledgerCount.textContent = total.toString().padStart(2, "0");
  elements.ledgerMore.textContent =
    total > visible.length
      ? `+ ${total - visible.length} MORE ACTIVE SLOTS`
      : total > 0
        ? "SHOWING ALL ACTIVE"
        : "NO ACTIVE PARTICLES";
}

function updateUi(now, force = false) {
  if (!system) return;
  if (!force && now - state.lastUiUpdate < 100) return;
  state.lastUiUpdate = now;

  const snapshot = system.snapshot();
  const load = snapshot.active / snapshot.capacity;
  const percentage = Math.min(100, load * 100);

  elements.activeCount.textContent = pad(snapshot.active, 4);
  elements.activeRatio.textContent = `${snapshot.active} / ${snapshot.capacity}`;
  elements.freeCount.textContent = formatInteger(snapshot.free);
  elements.reclaimedCount.textContent = formatInteger(snapshot.reclaimed);
  elements.droppedCount.textContent = formatInteger(snapshot.dropped);
  elements.capacityFill.style.width = `${percentage}%`;
  elements.capacityPeak.style.left = `${
    (snapshot.peak / snapshot.capacity) * 100
  }%`;
  elements.capacityFill.classList.toggle("overloaded", load > 0.84);
  elements.maxGeneration.textContent = `G${pad(
    snapshot.activeEntries.maxGeneration,
  )}`;
  elements.bufferSize.textContent = `${Math.round(snapshot.stateBytes / 1024)} KB`;
  elements.tfDraws.textContent = formatInteger(snapshot.tfDraws);
  elements.simTime.textContent = `T+ ${snapshot.simTime.toFixed(1)}s`;
  elements.frameRate.textContent = state.fps.toFixed(1);

  const source = snapshot.current;
  const destination = source ^ 1;
  elements.pingSrc.textContent = `P${source}`;
  elements.pingDst.textContent = `P${destination}`;
  elements.nodeA.classList.toggle("current", source === 0);
  elements.nodeB.classList.toggle("current", source === 1);
  elements.nodeA.innerHTML = `P0<small>${source === 0 ? "READ" : "WRITE"}</small>`;
  elements.nodeB.innerHTML = `P1<small>${source === 1 ? "READ" : "WRITE"}</small>`;

  renderLedger(
    snapshot.activeEntries.entries,
    snapshot.activeEntries.total,
  );

  if (snapshot.dropped > state.droppedSeen) showOverflow();
  state.droppedSeen = snapshot.dropped;

  if (now >= state.overflowUntil) {
    elements.overflowToast.classList.remove("visible");
  }
}

function updateClock() {
  const time = new Date();
  elements.clock.textContent = [time.getHours(), time.getMinutes(), time.getSeconds()]
    .map((part) => pad(part))
    .join(":");
}

function pointerWorldPosition(event) {
  const rect = elements.canvas.getBoundingClientRect();
  const normalizedX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const normalizedY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  return {
    x: (normalizedX * system.aspect) / 0.92,
    y: normalizedY / 0.84,
  };
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(Math.max((now - state.lastFrame) / 1000, 0), 0.05);
  state.lastFrame = now;

  if (system) {
    if (!state.paused) {
      if (dt > 0) {
        state.fps = state.fps * 0.92 + (1 / dt) * 0.08;
        state.emissionAccumulator += state.rate * dt;
        const emissionCount = Math.floor(state.emissionAccumulator);
        state.emissionAccumulator -= emissionCount;
        if (emissionCount > 0) emit(emissionCount);
        system.step(dt);
      }
    }
    system.render();
  }

  if (now - state.lastUiUpdate >= 100) updateUi(now);
  if (now >= state.overflowUntil) {
    elements.overflowToast.classList.remove("visible");
  }
}

elements.rate.addEventListener("input", (event) => setRate(event.target.value));

elements.capacityOptions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-capacity]");
  if (!button) return;
  resetSimulation(Number(button.dataset.capacity));
});

elements.burstButton.addEventListener("click", () => burst(180));
elements.pauseButton.addEventListener("click", () => setPaused(!state.paused));
elements.stressButton.addEventListener("click", () => {
  if (!system) return;
  const requested = system.pool.free + 128;
  emit(requested);
  updateUi(performance.now(), true);
});

elements.canvas.addEventListener("pointerdown", (event) => {
  if (!system || event.button !== 0) return;
  burst(52);
});

elements.canvas.addEventListener("pointermove", (event) => {
  if (!system) return;
  const position = pointerWorldPosition(event);
  system.setPointer(position.x, position.y, true);
});

elements.canvas.addEventListener("pointerleave", () => {
  if (system) system.clearPointer();
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") {
    event.preventDefault();
    setPaused(!state.paused);
  } else if (event.key.toLowerCase() === "b") {
    burst(180);
  } else if (event.key.toLowerCase() === "r") {
    resetSimulation();
  }
});

document.addEventListener("visibilitychange", () => {
  state.lastFrame = performance.now();
});

setRate(240);
updateClock();
setInterval(updateClock, 1000);
updateUi(performance.now(), true);
requestAnimationFrame(frame);
