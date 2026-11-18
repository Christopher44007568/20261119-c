"use strict";

const canvas = document.getElementById("gl");
const gl = canvas.getContext("webgl2", { antialias: true });
if (!gl) {
  document.body.innerHTML = "<p style='padding:20px'>WebGL2 不可用。</p>";
  throw new Error("no webgl2");
}

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(vsId, fsId) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER,
    document.getElementById(vsId).textContent));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER,
    document.getElementById(fsId).textContent));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p));
  }
  return p;
}

const prog = program("vs", "fs");
gl.useProgram(prog);

// Vertex record layout (see export_mesh.cpp):
// pos(3) normal(3) uv(2) tangent(3) refNormal(3) sign(1) degenerate(1)
const data = window.MESH_DATA;
const vCount = data.vertices.length;
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.vertices.flat()),
  gl.STATIC_DRAW);

const STRIDE = 16 * 4;
const layout = [
  [0, 3, 0], [1, 3, 3], [2, 2, 6], [3, 3, 8],
  [4, 3, 11], [5, 1, 14], [6, 1, 15],
];
for (const [loc, size, off] of layout) {
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, off * 4);
}

const ibo = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices),
  gl.STATIC_DRAW);
const indexCount = data.indices.length;

// ---- minimal mat4 helpers (column major) ----
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,  0, f, 0, 0,
    0, 0, (far + near) * nf, -1,  0, 0, 2 * far * near * nf, 0]);
}
function lookAt(eye, center, up) {
  const z = norm(sub(eye, center));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,  x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,  -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
function mul4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; ++c)
    for (let r = 0; r < 4; ++r)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
        + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ---- orbit camera ----
const cam = { yaw: 0.5, pitch: 0.45, dist: 9.0, panX: 0, panY: -0.4 };
function eyePos() {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  return [
    cam.panX + cam.dist * cp * Math.sin(cam.yaw),
    cam.panY + cam.dist * sp,
    cam.dist * cp * Math.cos(cam.yaw)];
}

const u = {
  viewProj: gl.getUniformLocation(prog, "uViewProj"),
  rot: gl.getUniformLocation(prog, "uMapRotation"),
  debug: gl.getUniformLocation(prog, "uDebugTbn"),
  light: gl.getUniformLocation(prog, "uLightDir"),
  viewPos: gl.getUniformLocation(prog, "uViewPos"),
  degN: gl.getUniformLocation(prog, "uDegenerateNormal"),
};
gl.uniform3fv(u.light, [0.4, 0.8, 0.45]);
gl.uniform3fv(u.degN, data.degenerateNormal);
gl.enable(gl.DEPTH_TEST);
gl.clearColor(0.078, 0.086, 0.11, 1);

// ---- line overlay program (TBN axes, grid) ----
const lineVS = `#version 300 es
layout(location=0) in vec3 aP; layout(location=1) in vec3 aC;
uniform mat4 uVP; out vec3 vC;
void main(){ vC = aC; gl_Position = uVP * vec4(aP,1.0); }`;
const lineFS = `#version 300 es
precision highp float; in vec3 vC; out vec4 o;
void main(){ o = vec4(vC,1.0); }`;
const lp = (() => {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, lineVS));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, lineFS));
  gl.linkProgram(p);
  return p;
})();
const uLineVP = gl.getUniformLocation(lp, "uVP");

function buildLineGeometry() {
  const axisLines = [];
  const gridLines = [];
  const stride = 4;
  for (let i = 0; i < vCount; i += stride) {
    const v = data.vertices[i];
    const o = [v[0], v[1], v[2]];
    const T = [v[8], v[9], v[10]];
    const N = [v[11], v[12], v[13]];
    const sign = v[14], len = 0.22;
    const B = norm(cross(N, T)).map((x, k) => x * sign);
    const push = (arr, a, b, c) => arr.push(...a, ...c, ...b, ...c);
    push(axisLines, o, o.map((x, k) => x + T[k] * len), [1, 0.33, 0.28]);
    push(axisLines, o, o.map((x, k) => x + B[k] * len), [0.28, 1, 0.39]);
    push(axisLines, o, o.map((x, k) => x + N[k] * len), [0.37, 0.53, 1]);
  }
  // Triangle edges as thin gray grid lines.
  for (let i = 0; i < indexCount; i += 3) {
    const ids = [data.indices[i], data.indices[i + 1], data.indices[i + 2]];
    const p = ids.map((id) => {
      const v = data.vertices[id];
      return [v[0], v[1], v[2] + 0.002];
    });
    const gray = [0.65, 0.68, 0.75];
    const push = (arr, a, b, c) => arr.push(...a, ...c, ...b, ...c);
    push(gridLines, p[0], p[1], gray);
    push(gridLines, p[1], p[2], gray);
    push(gridLines, p[2], p[0], gray);
  }
  const mk = (arr) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    return { buf, count: arr.length / 6 };
  };
  return { axes: mk(axisLines), grid: mk(gridLines) };
}
const lineGeo = buildLineGeometry();

function drawLineSet(vp, set) {
  gl.useProgram(lp);
  gl.uniformMatrix4fv(uLineVP, false, vp);
  gl.bindBuffer(gl.ARRAY_BUFFER, set.buf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.drawArrays(gl.LINES, 0, set.count);
  gl.useProgram(prog);
}

const state = { debug: false, axes: true, grid: true, rotation: 0 };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener("resize", resize);
resize();

function renderFrame() {
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const aspect = canvas.width / canvas.height;
  const proj = perspective(Math.PI / 4, aspect, 0.1, 100);
  const eye = eyePos();
  const vp = mul4(proj, lookAt(eye, [cam.panX, cam.panY, 0], [0, 1, 0]));

  gl.useProgram(prog);
  gl.uniformMatrix4fv(u.viewProj, false, vp);
  gl.uniform1f(u.rot, state.rotation);
  gl.uniform1i(u.debug, state.debug ? 1 : 0);
  gl.uniform3fv(u.viewPos, eye);
  gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);

  if (state.axes) drawLineSet(vp, lineGeo.axes);
  if (state.grid) drawLineSet(vp, lineGeo.grid);
}

function frame() {
  renderFrame();
  requestAnimationFrame(frame);
}
frame();

// ---- input ----
const drag = { mode: null, x: 0, y: 0 };
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousedown", (e) => {
  drag.mode = e.button === 2 ? "pan" : "orbit";
  drag.x = e.clientX; drag.y = e.clientY;
});
window.addEventListener("mouseup", () => { drag.mode = null; });
window.addEventListener("mousemove", (e) => {
  if (!drag.mode) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.mode === "orbit") {
    cam.yaw += dx * 0.006;
    cam.pitch = Math.max(-1.3, Math.min(1.45, cam.pitch + dy * 0.006));
  } else {
    cam.panX -= dx * 0.01;
    cam.panY += dy * 0.01;
  }
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  cam.dist = Math.max(3, Math.min(25, cam.dist * (1 + e.deltaY * 0.001)));
}, { passive: false });

const $ = (id) => document.getElementById(id);
$("modeTbn").onchange = (e) => { state.debug = e.target.checked; };
$("showAxes").onchange = (e) => { state.axes = e.target.checked; };
$("showGrid").onchange = (e) => { state.grid = e.target.checked; };
$("rot").oninput = (e) => {
  state.rotation = e.target.value * Math.PI / 180;
  $("rotVal").textContent = e.target.value + "°";
};
$("rot90").onclick = () => {
  const next = (parseFloat($("rot").value) + 90) % 360;
  $("rot").value = next;
  $("rot").dispatchEvent(new Event("input"));
};
$("reset").onclick = () => {
  Object.assign(cam, { yaw: 0.5, pitch: 0.45, dist: 9, panX: 0, panY: -0.4 });
};

// Test hook for the headless Node harness (no browser rAF there).
if (typeof module !== "undefined") module.exports = { renderFrame, state, cam };
