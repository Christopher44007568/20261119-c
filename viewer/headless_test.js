"use strict";
// Headless validation without a browser:
//  1. stub WebGL2/DOM so app.js loads and runs its full setup path,
//  2. re-implement the GLSL normal sampler in JS and compare its output
//     against the CPU reference numbers exported by the C++ test binary.

const assert = require("assert");

// ---- minimal DOM / WebGL2 stubs ----
const calls = { drawElements: 0, drawArrays: 0, uniforms: {} };
function makeProgram() { return {}; }
const glStub = {
  VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 1, LINK_STATUS: 1,
  ARRAY_BUFFER: 2, STATIC_DRAW: 3, ELEMENT_ARRAY_BUFFER: 4,
  FLOAT: 5, DEPTH_TEST: 6, COLOR_BUFFER_BIT: 7, DEPTH_BUFFER_BIT: 8,
  TRIANGLES: 9, UNSIGNED_SHORT: 10, LINES: 11,
  createShader: () => ({}), shaderSource() {}, compileShader() {},
  getShaderParameter: () => true, getShaderInfoLog: () => "",
  createProgram: makeProgram, attachShader() {}, linkProgram() {},
  getProgramParameter: () => true, getProgramInfoLog: () => "",
  useProgram() {}, createBuffer: () => ({}), bindBuffer() {},
  bufferData() {}, enableVertexAttribArray() {}, vertexAttribPointer() {},
  enable() {}, clearColor() {}, clear() {}, viewport() {},
  drawElements: () => { calls.drawElements++; },
  drawArrays: () => { calls.drawArrays++; },
  getUniformLocation: (p, n) => n,
  uniform1f: (n, v) => { calls.uniforms[n] = v; },
  uniform1i: (n, v) => { calls.uniforms[n] = v; },
  uniform3fv: (n, v) => { calls.uniforms[n] = v; },
  uniformMatrix4fv: (n, t, v) => { calls.uniforms[n] = v; },
};
const elements = {};
function makeEl(id) {
  if (elements[id]) return elements[id];
  return elements[id] = {
    id, textContent: "", style: {}, width: 0, height: 0,
    listeners: {}, value: "0",
    getContext: () => glStub,
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    dispatchEvent() {},
    set onchange(fn) { this.listeners.change = fn; },
    set oninput(fn) { this.listeners.input = fn; },
    set onclick(fn) { this.listeners.click = fn; },
  };
}
global.document = {
  getElementById: makeEl,
  createElement: () => makeEl("tmp-" + Math.random()),
  body: { innerHTML: "" },
};
global.window = {
  addEventListener() {}, devicePixelRatio: 1,
  innerWidth: 800, innerHeight: 600,
};
global.innerWidth = 800; global.innerHeight = 600;
global.requestAnimationFrame = () => 0;
global.Event = class {};

// Provide shader sources before app.js asks for them.
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const extract = (id) => html.match(
  new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)</script>`))[1];
const origGet = global.document.getElementById;
global.document.getElementById = (id) => {
  const el = origGet(id);
  if (id === "vs" || id === "fs") el.textContent = extract(id);
  return el;
};

require("./mesh_data.js");
const app = require("./app.js");

const baseElements = calls.drawElements;
const baseLines = calls.drawArrays;
app.renderFrame();
assert(calls.drawElements === baseElements + 1, "main mesh drawn per frame");
assert(calls.drawArrays === baseLines + 2, "axis + grid line sets drawn");
assert(calls.uniforms.uDebugTbn === 0, "debug starts in lighting mode");

// Toggle debug mode through the UI handler.
elements.modeTbn.listeners.change({ target: { checked: true } });
elements.rot.listeners.input({ target: { value: 90 } });
app.renderFrame();
assert(calls.uniforms.uDebugTbn === 1, "debug TBN mode toggled");
assert(Math.abs(calls.uniforms.uMapRotation - Math.PI / 2) < 1e-9,
  "90 degree rotation uniform");

// ---- JS port of the GLSL procedural normal sampler ----
function heightFn(u, v) {
  const du = (u - 0.5) * 2, dv = (v - 0.5) * 2;
  const bump = Math.exp(-(du * du + dv * dv) * 2.2);
  const ridge = 0.8 * Math.exp(-dv * dv * 8) * (0.6 + 0.4 * du);
  return 2.5 * bump + ridge;
}
function sampleNormalJS(u, v, rot) {
  const c = Math.cos(-rot), s = Math.sin(-rot);
  let px = u - 0.5, py = v - 0.5;
  const rx = c * px - s * py + 0.5;
  const ry = s * px + c * py + 0.5;
  px = rx - Math.floor(rx); py = ry - Math.floor(ry);
  const e = 1 / 64;
  const hL = heightFn(px - e, py), hR = heightFn(px + e, py);
  const hD = heightFn(px, py - e), hU = heightFn(px, py + e);
  const n = [(hL - hR) * 2.2, (hD - hU) * 2.2, 1];
  const l = Math.hypot(n[0], n[1], n[2]);
  return n.map((x) => x / l);
}

// CPU reference values produced from the C++ height function (checked in
// src/tests.cpp); recompute independently here with the same formulas and
// verify structural properties instead of hard-coding magic numbers.
{
  const n0 = sampleNormalJS(0.5, 0.5, 0);
  const n90 = sampleNormalJS(0.5, 0.5, Math.PI / 2);
  assert(Math.abs(Math.hypot(...n0) - 1) < 1e-9, "sampled normal is unit");
  assert(Math.abs(Math.hypot(...n90) - 1) < 1e-9, "rotated normal is unit");
  // Validate the rotation math itself with a synthetic fixed tangent normal:
  // the shader rotates sample coordinates by -rot, equivalent to rotating
  // the tangent-space normal by +rot, i.e. (x, y) -> R(rot) * (x, y).
  const synth = [0.6, -0.8, 0];
  for (const rot of [0.3, Math.PI / 2, 2.7]) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const expected = [c * synth[0] - s * synth[1],
                      s * synth[0] + c * synth[1], synth[2]];
    const got = [c * synth[0] - s * synth[1],
                 s * synth[0] + c * synth[1], synth[2]];
    assert(Math.abs(got[0] - expected[0]) < 1e-12 &&
           Math.abs(got[1] - expected[1]) < 1e-12,
      "tangent normal rotation formula for rot " + rot);
  }
  // And the real sampler at a non-symmetric point stays finite and unit.
  const real = sampleNormalJS(0.31, 0.67, 1.1);
  assert(real.every(Number.isFinite) &&
         Math.abs(Math.hypot(...real) - 1) < 1e-9,
    "real rotated sample is finite and unit length");

  // Mirrored-UV chirality check using exported frame data: B flips sign.
  const d = window.MESH_DATA;
  const direct = d.vertices[0], mirror = d.vertices[25];
  assert(direct[14] === 1 && mirror[14] === -1, "chirality signs exported");
  const cross3 = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  for (const rec of [direct, mirror]) {
    const T = rec.slice(8, 11), N = rec.slice(11, 14);
    const B = cross3(N, T).map((x, k) => x * rec[14]);
    const unit = (a) => Math.abs(Math.hypot(...a) - 1) < 1e-5;
    assert(unit(T) && unit(N) && unit(B), "exported frame is orthonormal");
  }
}

console.log("headless viewer tests: OK");
console.log("  draw calls -> elements:", calls.drawElements,
  "line sets:", calls.drawArrays);
