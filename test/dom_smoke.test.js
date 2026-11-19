// Headless smoke test for the UI controller using minimal DOM/Canvas stubs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeCanvas() {
  const noop = () => {};
  return {
    width: 920,
    height: 640,
    style: {},
    getContext: () => new Proxy({}, {
      get: (t, prop) => {
        if (prop === "measureText") return () => ({ width: 10 });
        return typeof prop === "string" ? noop : undefined;
      },
      set: () => true,
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 920, height: 640 }),
    setPointerCapture: noop,
    addEventListener: noop,
  };
}

function makeElement(id) {
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    checked: false,
    classList: { add: () => {}, remove: () => {} },
    style: {},
    listeners: {},
    children: [],
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(child) { this.children.push(child); },
    querySelectorAll: () => [],
  };
}

test("app.js initializes, solves and updates after a simulated drag", () => {
  const elements = new Map();
  const ids = ["scene", "tooltip", "maxBounces", "maxBouncesVal",
    "sampleCount", "sampleCountVal", "receiverRadius", "receiverRadiusVal",
    "showRejected", "showSampling", "showReached", "showLabels",
    "stats", "pathList"];
  for (const id of ids) elements.set(id, makeElement(id));
  elements.get("maxBounces").value = "3";
  elements.get("sampleCount").value = "720";
  elements.get("receiverRadius").value = "0.15";
  for (const id of ["showRejected", "showReached", "showLabels"]) {
    elements.get(id).checked = true;
  }

  const canvas = makeCanvas();
  const canvasListeners = {};
  canvas.addEventListener = (type, fn) => { canvasListeners[type] = fn; };
  elements.set("scene", canvas);

  const sandbox = {
    console,
    document: {
      getElementById: (id) => elements.get(id),
      querySelectorAll: () => [],
      createElement: () => makeElement("li"),
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  const load = (file) => vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox,
    { filename: file });
  load("src/geometry.js");
  load("src/solver.js");
  load("src/presets.js");
  load("src/app.js");

  // After init the stats panel was populated with real solver output.
  const stats = elements.get("stats").innerHTML;
  assert.match(stats, /有效光路/);
  assert.match(stats, /采样/);
  const list = elements.get("pathList");
  assert.ok(list.children.length >= 3, "parallel preset yields several paths");

  // Simulate dragging the top mirror downward: pointerdown then pointermove.
  const down = canvasListeners.pointerdown;
  const move = canvasListeners.pointermove;
  assert.equal(typeof down, "function");
  assert.equal(typeof move, "function");

  const app = sandbox.window.__solverApp;
  assert.ok(app, "app exposes a test hook");
  const topBefore = app.state.scene.mirrors[1].a.y;
  const pathCountBefore = app.state.result.valid.length;

  // Grab a point near the top mirror body at world (0, 4) -> screen coords.
  const scale = 58, ox = 250, oy = 470;
  const screenOf = (p) => ({ x: ox + p.x * scale, y: oy - p.y * scale });
  const grab = screenOf({ x: 0, y: 4 });
  down({ button: 0, pointerId: 1, clientX: grab.x, clientY: grab.y });
  const target = screenOf({ x: 0, y: 3.4 });
  move({ pointerId: 1, clientX: target.x, clientY: target.y, offsetX: 10, offsetY: 10 });

  const topAfter = app.state.scene.mirrors[1].a.y;
  assert.ok(Math.abs((topBefore - topAfter) - 0.6) < 0.05,
    `mirror translated ~0.6 units (was ${topBefore}, now ${topAfter})`);
  assert.ok(elements.get("stats").innerHTML.includes("有效光路"),
    "stats still populated after drag");
  assert.ok(app.state.result.valid.length >= 1);
  assert.ok(app.state.result.valid.length !== pathCountBefore ||
    app.state.result.valid.some((p) => p.points.some((q) => q.y !== 0)),
    "solution recomputed after geometry change");
});
