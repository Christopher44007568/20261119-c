// WebGL2 演示：SH 漫反射辐照度 + 低频高光 vs 高采样蒙特卡洛参考。
"use strict";

const canvas = document.getElementById("view");
const gl = canvas.getContext("webgl2");
const floatExt = gl && gl.getExtension("EXT_color_buffer_float");

const VIEW_W = 320, VIEW_H = 320;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// 场景着色器：解析求交（球+地面），三种模式：SH / 参考 / 差值
const SCENE_FRAG = `#version 300 es
precision highp float;
uniform int uMode;       // 0=SH 1=参考 2=差值x10
uniform int uEnv;        // 0=常量 1=宽光斑 2=高频
uniform mat3 uEnvRotInv; // 环境旋转的逆（参考路径用）
uniform vec3 uSH[16];    // 已旋转、已截断到当前阶数的系数
uniform float uScaleD[16];
uniform float uScaleS[16];
uniform float uShininess;
uniform float uKs;
uniform int uSamples;
uniform int uBg;         // 0=真实环境 1=SH重建 2=残差x5
uniform vec3 uLobeDir[24];
uniform vec3 uLobeCol[24];
uniform float uViewX;    // 当前视口的帧缓冲 x 偏移
out vec4 fragColor;

vec3 envRot(vec3 d) { return uEnvRotInv * d; }

vec3 env(vec3 d) {
  vec3 w = envRot(d);
  if (uEnv == 0) return vec3(1.0);
  if (uEnv == 1) {
    vec3 sd = normalize(vec3(0.4, 0.6, 0.693));
    float l = pow(max(dot(w, sd), 0.0), 6.0);
    return vec3(0.05) + l * vec3(1.0, 0.85, 0.6);
  }
  vec3 c = vec3(0.02);
  for (int i = 0; i < 24; i++) {
    float l = pow(max(dot(w, uLobeDir[i]), 0.0), 400.0) * 6.0;
    c += l * uLobeCol[i];
  }
  return c;
}

void shBasis(vec3 d, out float b[16]) {
  float x = d.x, y = d.y, z = d.z;
  b[0] = 0.28209479;
  b[1] = 0.48860251 * y; b[2] = 0.48860251 * z; b[3] = 0.48860251 * x;
  b[4] = 1.09254843 * x * y; b[5] = 1.09254843 * y * z;
  b[6] = 0.31539157 * (3.0 * z * z - 1.0);
  b[7] = 1.09254843 * x * z; b[8] = 0.54627422 * (x * x - y * y);
  b[9] = 0.59004359 * y * (3.0 * x * x - y * y);
  b[10] = 2.89061144 * x * y * z;
  b[11] = 0.45704580 * y * (4.0 * z * z - x * x - y * y);
  b[12] = 0.37317633 * z * (2.0 * z * z - 3.0 * x * x - 3.0 * y * y);
  b[13] = 0.45704580 * x * (4.0 * z * z - x * x - y * y);
  b[14] = 1.44530572 * z * (x * x - y * y);
  b[15] = 0.59004359 * x * (x * x - 3.0 * y * y);
}

vec3 shEval(vec3 d, float scale[16]) {
  float b[16];
  shBasis(d, b);
  vec3 e = vec3(0.0);
  for (int i = 0; i < 16; i++) e += scale[i] * b[i] * uSH[i];
  return max(e, vec3(0.0)); // 截断 SH 振铃产生的负值
}

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 mcDiffuse(vec3 n, int N) {
  vec3 acc = vec3(0.0);
  float rnd = hash12(gl_FragCoord.xy) * 6.2831853;
  for (int i = 0; i < 512; i++) {
    if (i >= N) break;
    float t = (float(i) + 0.5) / float(N);
    float z = 1.0 - 2.0 * t;
    float th = 2.39996323 * (float(i) + 0.5) + rnd;
    float r = sqrt(max(0.0, 1.0 - z * z));
    vec3 w = vec3(r * cos(th), r * sin(th), z);
    float cw = dot(w, n);
    if (cw > 0.0) acc += env(w) * cw;
  }
  return acc * (4.0 * 3.14159265 / float(N));
}

vec3 mcSpec(vec3 rdir, int N, float n) {
  vec3 acc = vec3(0.0);
  float lsum = 0.0;
  float rnd = hash12(gl_FragCoord.xy + 17.0) * 6.2831853;
  for (int i = 0; i < 512; i++) {
    if (i >= N) break;
    float t = (float(i) + 0.5) / float(N);
    float z = 1.0 - 2.0 * t;
    float th = 2.39996323 * (float(i) + 0.5) + rnd;
    float r = sqrt(max(0.0, 1.0 - z * z));
    vec3 w = vec3(r * cos(th), r * sin(th), z);
    float lw = pow(max(dot(w, rdir), 0.0), n);
    acc += env(w) * lw;
    lsum += lw;
  }
  return acc / max(lsum, 1e-6);
}

vec3 shade(vec3 p, vec3 n, vec3 albedo, vec3 rd) {
  vec3 r = reflect(rd, n);
  vec3 shC = vec3(0.0), refC = vec3(0.0);
  if (uMode == 0 || uMode == 2)
    shC = albedo / 3.14159265 * shEval(n, uScaleD) + uKs * shEval(r, uScaleS);
  if (uMode == 1 || uMode == 2)
    refC = albedo / 3.14159265 * mcDiffuse(n, uSamples) + uKs * mcSpec(r, uSamples, uShininess);
  if (uMode == 0) return shC;
  if (uMode == 1) return refC;
  return abs(shC - refC) * 10.0;
}

vec3 background(vec3 rd) {
  if (uMode == 2) return vec3(0.0);
  vec3 envC = env(rd);
  if (uBg == 0) return envC;
  float one[16];
  for (int i = 0; i < 16; i++) one[i] = 1.0;
  vec3 recon = shEval(rd, one);
  if (uBg == 1) return recon;
  return abs(envC - recon) * 5.0; // 高频残差显式可视化
}

void main() {
  vec2 uv = ((gl_FragCoord.xy - vec2(uViewX, 0.0)) / vec2(320.0, 320.0)) * 2.0 - 1.0;
  vec3 eye = vec3(0.0, 0.9, 3.0);
  vec3 fwd = normalize(vec3(0.0, -0.05, 0.0) - eye);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd + 0.7 * (uv.x * right + uv.y * up));

  // 球（原点，半径1）
  float tHit = 1e9;
  vec3 albedo = vec3(0.0), normal = vec3(0.0);
  bool hit = false;
  {
    vec3 oc = eye;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - 1.0;
    float h = b * b - c;
    if (h > 0.0) {
      float t = -b - sqrt(h);
      if (t > 0.0) { tHit = t; hit = true; normal = normalize(eye + t * rd); albedo = vec3(0.8); }
    }
  }
  // 地面 y=-1
  if (rd.y < 0.0) {
    float t = (-1.0 - eye.y) / rd.y;
    if (t > 0.0 && t < tHit) {
      tHit = t; hit = true;
      vec3 p = eye + t * rd;
      normal = vec3(0.0, 1.0, 0.0);
      float chk = mod(floor(p.x) + floor(p.z), 2.0);
      albedo = mix(vec3(0.3), vec3(0.6), chk);
    }
  }

  vec3 col = hit ? shade(eye + tHit * rd, normal, albedo, rd) : background(rd);
  fragColor = vec4(col, 1.0);
}`;

// 显示着色器：tonemap + gamma
const BLIT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uOffset; // 源视口偏移
out vec4 fragColor;
void main() {
  vec2 uv = uOffset + gl_FragCoord.xy / vec2(960.0, 320.0);
  vec3 c = texture(uTex, uv).rgb;
  c = c / (1.0 + c);
  fragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function link(vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// ---------------- 应用状态 ----------------

const ui = {};
for (const id of ["env", "order", "angle", "angleVal", "spin", "shininess",
                  "samples", "bg", "metrics", "runChecks", "spinOnce", "checkOut"])
  ui[id] = document.getElementById(id);

const state = {
  coefsOrig: null,   // 未旋转的 16x3 系数（当前环境）
  coefsRot: null,    // 实时旋转后的系数
  envId: "spot",
  order: 2,
  angleDeg: 30,
  shininess: 8,
  samples: 256,
  bg: 0,
  spin: false,
};

const ENV_IDS = { constant: 0, spot: 1, highfreq: 2 };

// 预计算各环境的 SH 系数（低频光照近似：只保留到 L3）
const coefsByEnv = {};
function ensureProjected(envId) {
  if (!coefsByEnv[envId]) coefsByEnv[envId] = projectEnv(ENVS[envId]);
  return coefsByEnv[envId];
}

const residByEnv = {};
function ensureResidual(envId) {
  if (!residByEnv[envId]) residByEnv[envId] = residualReport(ENVS[envId], ensureProjected(envId));
  return residByEnv[envId];
}

function updateRotation() {
  const orig = ensureProjected(state.envId);
  const rot = rotAxisAngle(0, 1, 0, state.angleDeg * Math.PI / 180);
  const D = shRotationMatrix(rot);
  state.coefsRot = truncateOrder(shRotate(orig, D), state.order);
  return rot;
}

// ---------------- GL 资源 ----------------

const sceneProg = link(VERT, SCENE_FRAG);
const blitProg = link(VERT, BLIT_FRAG);
const U = {};
for (const name of ["uMode", "uEnv", "uEnvRotInv", "uSH[0]", "uScaleD[0]",
                    "uScaleS[0]", "uShininess", "uKs", "uSamples", "uBg",
                    "uLobeDir[0]", "uLobeCol[0]", "uViewX"])
  U[name] = gl.getUniformLocation(sceneProg, name);
const UB = {
  tex: gl.getUniformLocation(blitProg, "uTex"),
  offset: gl.getUniformLocation(blitProg, "uOffset"),
};

// 浮点帧缓冲（保留线性 HDR 供误差统计）
const fbo = gl.createFramebuffer();
const fboTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, fboTex);
const useFloat = !!floatExt;
gl.texImage2D(gl.TEXTURE_2D, 0, useFloat ? gl.RGBA32F : gl.RGBA8,
              960, 320, 0, gl.RGBA, useFloat ? gl.FLOAT : gl.UNSIGNED_BYTE, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

function uploadSceneUniforms(rotInv) {
  gl.useProgram(sceneProg);
  gl.uniform1i(U["uEnv"], ENV_IDS[state.envId]);
  gl.uniformMatrix3fv(U["uEnvRotInv"], false, mat3Transpose(rotInv));
  gl.uniform3fv(U["uSH[0]"], state.coefsRot);
  gl.uniform1fv(U["uScaleD[0]"], lambertScale());
  gl.uniform1fv(U["uScaleS[0]"], specularScale(state.shininess));
  gl.uniform1f(U["uShininess"], state.shininess);
  gl.uniform1f(U["uKs"], 0.5);
  gl.uniform1i(U["uSamples"], state.samples);
  gl.uniform1i(U["uBg"], state.bg);
  const dirs = [], cols = [];
  for (const { dir, col } of HF_LOBES) { dirs.push(...dir); cols.push(...col); }
  gl.uniform3fv(U["uLobeDir[0]"], dirs);
  gl.uniform3fv(U["uLobeCol[0]"], cols);
}

// 环境旋转（列主序上传需转置）；rot 为行主序 Float64Array(9)
function mat3Transpose(m) {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

function render() {
  const rot = updateRotation();
  // 参考路径用 R^-1 采样环境：env(w) 内部已左乘 uEnvRotInv
  const rotInv = rotAxisAngle(0, 1, 0, -state.angleDeg * Math.PI / 180);
  uploadSceneUniforms(rotInv);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, 960, 320);
  for (let mode = 0; mode < 3; mode++) {
    gl.viewport(mode * 320, 0, 320, 320);
    gl.uniform1i(U["uMode"], mode);
    gl.uniform1f(U["uViewX"], mode * 320);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // 误差统计（SH 视口 vs 参考视口，线性域）
  const px = new (useFloat ? Float32Array : Uint8Array)(320 * 320 * 4);
  gl.readPixels(0, 0, 320, 320, gl.RGBA, useFloat ? gl.FLOAT : gl.UNSIGNED_BYTE, px);
  const shPix = px.slice();
  gl.readPixels(320, 0, 320, 320, gl.RGBA, useFloat ? gl.FLOAT : gl.UNSIGNED_BYTE, px);
  const scale = useFloat ? 1 : 1 / 255;
  let se = 0, ae = 0, mx = 0, n = 0;
  for (let i = 0; i < 320 * 320 * 4; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const d = (shPix[i + ch] - px[i + ch]) * scale;
      se += d * d; ae += Math.abs(d); mx = Math.max(mx, Math.abs(d)); n++;
    }
  }
  const rmse = Math.sqrt(se / n), mae = ae / n;

  // 残差能量报告（当前环境，按阶数）
  const resid = ensureResidual(state.envId);
  ui.metrics.textContent =
    `SH(L${state.order}) vs 高采样参考(${state.samples}spp)：\n` +
    `  RMSE = ${rmse.toFixed(4)}   MAE = ${mae.toFixed(4)}   MaxErr = ${mx.toFixed(4)}\n` +
    `  环境能量残差比（低阶无法表达部分）：L0=${pct(resid[1])} L1=${pct(resid[2])} ` +
    `L2=${pct(resid[3])} L3=${pct(resid[4])}\n` +
    `  注：仅评估低频光照近似；残差为高频细节固有表达极限。`;

  // 上屏
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, 960, 320);
  gl.useProgram(blitProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.uniform1i(UB.tex, 0);
  gl.uniform2f(UB.offset, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function pct(x) { return (x * 100).toFixed(2) + "%"; }

// ---------------- 验证（与 tools/validate_sh.py 对应） ----------------

function runChecks() {
  const lines = [];
  // 1. 常量环境：仅 0 阶非零
  {
    const c = ensureProjected("constant");
    let hi = 0;
    for (let i = 3; i < SH_N * 3; i++) hi = Math.max(hi, Math.abs(c[i]));
    const expect = 4 * Math.PI * 0.28209479177387814;
    const ok = hi < 1e-4 && Math.abs(c[0] - expect) < 1e-3;
    lines.push(`[常量环境] c00=${c[0].toFixed(6)} (期望 ${expect.toFixed(6)}), ` +
               `高阶最大|系数|=${hi.toExponential(2)} -> ${ok ? "PASS" : "FAIL"}`);
  }
  // 2. 宽光斑：1 阶向量对准光源方向
  {
    const c = ensureProjected("spot");
    const m = [c[3 * 3], c[1 * 3], c[2 * 3]];
    const len = Math.hypot(...m);
    const cos = (m[0] * SPOT_DIR[0] + m[1] * SPOT_DIR[1] + m[2] * SPOT_DIR[2]) / len;
    lines.push(`[宽光斑] 1阶向量与光源方向夹角 cos=${cos.toFixed(6)} -> ${cos > 0.999 ? "PASS" : "FAIL"}`);
  }
  // 3. 旋转一周复原
  {
    const c = ensureProjected(state.envId);
    const D = shRotationMatrix(rotAxisAngle(0, 1, 0, 2 * Math.PI));
    const cr = shRotate(c, D);
    let err = 0;
    for (let i = 0; i < SH_N * 3; i++) err = Math.max(err, Math.abs(cr[i] - c[i]));
    lines.push(`[旋转复原] 整周(2π)最大偏差=${err.toExponential(2)} -> ${err < 1e-5 ? "PASS" : "FAIL"}`);
  }
  // 4. 旋转系数 vs 重投影系数
  {
    const rot = rotAxisAngle(0.2, 0.9, 0.4, 1.1);
    const c = ensureProjected("spot");
    const cRot = shRotate(c, shRotationMatrix(rot));
    // L'(w) = L(R^-1 w)：行向量 d@R
    const cRef = projectEnv(d => envSpot([
      d[0] * rot[0] + d[1] * rot[3] + d[2] * rot[6],
      d[0] * rot[1] + d[1] * rot[4] + d[2] * rot[7],
      d[0] * rot[2] + d[1] * rot[5] + d[2] * rot[8],
    ]), 8192);
    let err = 0;
    for (let i = 0; i < SH_N * 3; i++) err = Math.max(err, Math.abs(cRot[i] - cRef[i]));
    lines.push(`[旋转正确性] 旋转系数 vs 重投影 最大偏差=${err.toExponential(2)} -> ${err < 2e-3 ? "PASS" : "FAIL"}`);
  }
  // 5. 高频残差显式报告
  {
    const resid = residualReport(envHighFreq, ensureProjected("highfreq"));
    lines.push(`[高频残差] 低阶无法表达的能量占比：L0=${pct(resid[1])} L1=${pct(resid[2])} ` +
               `L2=${pct(resid[3])} L3=${pct(resid[4])}`);
    lines.push("  说明：残差为窄光斑/硬阴影边界等高频细节，属低频近似固有极限，");
    lines.push("        不随旋转或采样增加而消失。本演示只评估低频光照近似。");
  }
  ui.checkOut.textContent = lines.join("\n");
}

// 360 步 × 1° 连续旋转后应恢复原系数（模拟实时拖动一周）
function spinOnceCheck() {
  const c = ensureProjected(state.envId);
  const D = shRotationMatrix(rotAxisAngle(0, 1, 0, Math.PI / 180));
  let cur = c;
  for (let i = 0; i < 360; i++) cur = shRotate(cur, D);
  let err = 0;
  for (let i = 0; i < SH_N * 3; i++) err = Math.max(err, Math.abs(cur[i] - c[i]));
  ui.checkOut.textContent =
    `[旋转一周] 360×1° 复合旋转后最大系数偏差=${err.toExponential(3)} ` +
    `-> ${err < 1e-4 ? "PASS（系数复原）" : "FAIL"}\n` +
    ui.checkOut.textContent;
}

// ---------------- UI 事件与主循环 ----------------

function syncState() {
  state.envId = ui.env.value;
  state.order = parseInt(ui.order.value, 10);
  state.angleDeg = parseFloat(ui.angle.value);
  state.shininess = parseFloat(ui.shininess.value);
  state.samples = parseInt(ui.samples.value, 10);
  state.bg = parseInt(ui.bg.value, 10);
  state.spin = ui.spin.checked;
  ui.angleVal.textContent = `${state.angleDeg.toFixed(0)}°`;
}

let dirty = true;
function requestRender() { dirty = true; }

for (const el of [ui.env, ui.order, ui.angle, ui.shininess, ui.samples, ui.bg])
  el.addEventListener("input", () => { syncState(); requestRender(); });
ui.spin.addEventListener("change", syncState);
ui.runChecks.addEventListener("click", runChecks);
ui.spinOnce.addEventListener("click", spinOnceCheck);

let lastFrame = 0;
function loop(t) {
  if (state.spin && t - lastFrame > 33) {
    state.angleDeg = (state.angleDeg + 1) % 360;
    ui.angle.value = state.angleDeg;
    ui.angleVal.textContent = `${state.angleDeg.toFixed(0)}°`;
    dirty = true;
  }
  if (dirty) {
    dirty = false;
    lastFrame = t;
    render();
  }
  requestAnimationFrame(loop);
}

syncState();
requestAnimationFrame(loop);
