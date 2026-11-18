// Interactive brushed-metal demo: anisotropic GGX, same math as brdf.mjs.

const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl2');
if (!gl) {
  document.body.innerHTML = '<p style="padding:2em">需要 WebGL2 支持。</p>';
  throw new Error('WebGL2 unavailable');
}

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vPos;
void main() {
  vNormal = aNormal;
  vPos = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vPos;
out vec4 fragColor;

uniform vec3 uLightDir;    // toward the light
uniform vec3 uViewPos;
uniform float uTangentRot; // radians, rotates tangent around the normal
uniform float uRoughX;     // roughness along the tangent
uniform float uRoughY;     // roughness along the bitangent

float D_ggx_aniso(vec3 T, vec3 B, vec3 N, vec3 H, float ax, float ay) {
  float hx = dot(H, T), hy = dot(H, B), hz = dot(H, N);
  if (hz <= 0.0) return 0.0;
  float d = hx*hx/(ax*ax) + hy*hy/(ay*ay) + hz*hz;
  return 1.0 / (3.14159265 * ax * ay * d * d);
}

float lambda_ggx(vec3 T, vec3 B, vec3 N, vec3 w, float ax, float ay) {
  float wx = dot(w, T), wy = dot(w, B), wz = dot(w, N);
  float term = ax*ax*wx*wx + ay*ay*wy*wy;
  if (term < 1e-8) return 0.0;
  return (-1.0 + sqrt(1.0 + term / (wz * wz))) * 0.5;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uViewPos - vPos);
  vec3 L = normalize(uLightDir);
  float ndl = dot(N, L), ndv = dot(N, V);
  if (ndl <= 0.0 || ndv <= 0.0) {
    fragColor = vec4(vec3(0.012), 1.0);
    return;
  }

  // Base tangent follows latitude circles (brushed look), then rotates.
  vec3 up = abs(N.y) > 0.98 ? vec3(1,0,0) : vec3(0,1,0);
  vec3 T0 = normalize(cross(up, N));
  vec3 B0 = cross(N, T0);
  float c = cos(uTangentRot), s = sin(uTangentRot);
  vec3 T = normalize(T0 * c + B0 * s);
  vec3 B = cross(N, T);

  float ax = max(uRoughX * uRoughX, 1e-3);
  float ay = max(uRoughY * uRoughY, 1e-3);

  vec3 H = normalize(L + V);
  float D = D_ggx_aniso(T, B, N, H, ax, ay);
  float G2 = 1.0 / (1.0 + lambda_ggx(T, B, N, L, ax, ay)
                        + lambda_ggx(T, B, N, V, ax, ay));
  vec3 F0 = vec3(0.92, 0.90, 0.88);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - clamp(dot(H, V), 0.0, 1.0), 5.0);

  vec3 spec = F * (D * G2 / (4.0 * ndl * ndv));
  vec3 color = spec * ndl * vec3(1.0, 0.98, 0.95) * 3.0
             + F0 * 0.03; // faint ambient so the silhouette reads

  color = color / (1.0 + color);
  color = pow(color, vec3(1.0 / 2.2));
  fragColor = vec4(color, 1.0);
}`;

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh));
  }
  return sh;
}

const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(prog));
}
gl.useProgram(prog);

const U = {};
for (const name of ['uViewProj', 'uLightDir', 'uViewPos', 'uTangentRot', 'uRoughX', 'uRoughY']) {
  U[name] = gl.getUniformLocation(prog, name);
}

// --- sphere geometry (unit sphere, normals == positions) ---
function buildSphere(cols, rows) {
  const verts = [];
  const idx = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const phi = v * Math.PI;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const theta = u * 2 * Math.PI;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      verts.push(x, y, z, x, y, z);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
}

const sphere = buildSphere(160, 120);
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, sphere.verts, gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
const ibo = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.idx, gl.STATIC_DRAW);

// --- minimal mat4 helpers (column-major) ---
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0,
    0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

function lookAt(eye, center, up) {
  const z = norm3(sub3(eye, center));
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ];
}

function mul4(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// --- UI wiring ---
const ui = {};
for (const id of ['lightAz', 'lightEl', 'tangentRot', 'roughX', 'roughY']) {
  ui[id] = document.getElementById(id);
  const out = ui[id].closest('.row').querySelector('output');
  const fmt = () => { out.textContent = Number(ui[id].value).toFixed(id.startsWith('rough') ? 2 : 0); };
  ui[id].addEventListener('input', fmt);
  fmt();
}
const spin = document.getElementById('spin');

const eye = [0, 0.9, 2.6];

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (spin.checked) {
    ui.lightAz.value = (Number(ui.lightAz.value) + dt * 30) % 360;
    ui.lightAz.dispatchEvent(new Event('input'));
  }
  resize();

  const az = (Number(ui.lightAz.value) * Math.PI) / 180;
  const el = (Number(ui.lightEl.value) * Math.PI) / 180;
  const light = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];

  const aspect = canvas.width / Math.max(canvas.height, 1);
  const proj = perspective(Math.PI / 4, aspect, 0.1, 20);
  const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  const viewProj = mul4(proj, view);

  gl.clearColor(0.055, 0.06, 0.07, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);

  gl.uniformMatrix4fv(U.uViewProj, false, new Float32Array(viewProj));
  gl.uniform3fv(U.uLightDir, light);
  gl.uniform3fv(U.uViewPos, eye);
  gl.uniform1f(U.uTangentRot, (Number(ui.tangentRot.value) * Math.PI) / 180);
  gl.uniform1f(U.uRoughX, Number(ui.roughX.value));
  gl.uniform1f(U.uRoughY, Number(ui.roughY.value));

  gl.drawElements(gl.TRIANGLES, sphere.idx.length, gl.UNSIGNED_SHORT, 0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
