// Water reflection demo: mirror camera + oblique clip plane, calm-water
// geometric reference, clamped normal-perturbed reflection sampling.

import {
  perspective, lookAt, mirrorView, planeToView, makeOblique,
  planeSide, projectToUV, reflectPoint,
} from './math.mjs';
import { reflectionError, waterFootprint } from './water.mjs';
import { compileProgram, createMesh, createTarget } from './gl.mjs';
import { cubeGeometry, sphereGeometry, waterGeometry } from './scene.mjs';
import {
  SCENE_VS, SCENE_FS, WATER_VS, WATER_FS, LINE_VS, LINE_FS,
} from './shaders.mjs';
import { renderDebugView } from './debug.mjs';
import { createHud } from './hud.mjs';

const WATER_N = [0, 1, 0];
const CLIP_D = -0.02; // clip plane y=0.02: keeps above-water geometry

export async function start(canvas, hudEl) {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');

  const sceneP = compileProgram(gl, SCENE_VS, SCENE_FS);
  const waterP = compileProgram(gl, WATER_VS, WATER_FS);
  const lineP = compileProgram(gl, LINE_VS, LINE_FS);

  const cube = cubeGeometry();
  const sphere = sphereGeometry();
  const cubeMesh = createMesh(gl, new Float32Array(cube.positions),
    new Float32Array(cube.normals), new Uint16Array(cube.indices));
  const sphereMesh = createMesh(gl, new Float32Array(sphere.positions),
    new Float32Array(sphere.normals), new Uint16Array(sphere.indices));
  const water = waterGeometry(6);
  const waterMesh = createMesh(gl, new Float32Array(water.positions),
    new Float32Array(water.normals), new Uint16Array(water.indices));

  const objects = [
    { mesh: cubeMesh, pos: [-2.2, 0.75, -1.5], s: [1.5, 1.5, 1.5], color: [0.85, 0.45, 0.15] },
    { mesh: cubeMesh, pos: [2.1, 1.5, -2.6], s: [1.0, 3.0, 1.0], color: [0.2, 0.6, 0.65] },
    { mesh: cubeMesh, pos: [0.6, 0.4, 2.2], s: [0.8, 0.8, 0.8], color: [0.5, 0.35, 0.8] },
    { mesh: cubeMesh, pos: [-1.6, -0.6, 1.2], s: [1.0, 1.0, 1.0], color: [0.45, 0.45, 0.5] },
    { mesh: sphereMesh, pos: [1.3, 0, 1.0], s: [1.6, 1.6, 1.6], color: [0.85, 0.25, 0.3], crossing: true },
  ];

  const state = {
    gl, canvas, timerExt,
    progs: { scene: sceneP, water: waterP, line: lineP },
    meshes: { cube: cubeMesh, sphere: sphereMesh, water: waterMesh },
    objects, water,
    reflRes: 1024,
    perturb: true,
    clamp: true,
    debugView: true,
    orbit: { angle: 0.7, height: 3.2, radius: 8.5, drag: false },
    cam: null, mirror: null, clipView: null,
    reflVP: null, footprint: null,
    timing: { cpuMs: 0, gpuMs: null },
    errOn: null, errOff: null, clipCheck: null,
    target: createTarget(gl, 1024, 1024),
    timer: { query: null, pending: false },
  };

  const hud = createHud(hudEl, state);
  attachOrbit(canvas, state);

  gl.enable(gl.DEPTH_TEST);

  let last = performance.now();
  function frame(now) {
    const t = now / 1000;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!state.orbit.drag) state.orbit.angle += dt * 0.08;

    updateCamera(state);
    // sphere bobs across the water plane
    objects[4].pos[1] = 1.0 * Math.sin(t * 0.7);

    renderReflection(state, t);
    renderMain(state, t);
    if (state.debugView) renderDebugView(state);
    updateMetrics(state, t);
    hud.update();
    requestAnimationFrame(frame);
  }
  fitCanvas(canvas);
  addEventListener('resize', () => fitCanvas(canvas));
  requestAnimationFrame(frame);
}

function fitCanvas(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

function updateCamera(state) {
  const { angle, height, radius } = state.orbit;
  const eye = [Math.sin(angle) * radius, Math.max(height, 0.4), Math.cos(angle) * radius];
  const center = [0, 0.3, 0];
  const up = [0, 1, 0];
  const aspect = state.canvas.width / state.canvas.height;
  const proj = perspective(Math.PI / 3.6, aspect, 0.1, 100);
  const view = lookAt(eye, center, up);
  const mView = mirrorView(eye, center, up, WATER_N, 0);
  const clipView = planeToView(mView, WATER_N, CLIP_D);
  const mProj = makeOblique(proj, clipView);
  state.cam = { eye, center, up, proj, view };
  state.mirror = {
    view: mView,
    proj: mProj,
    eye: reflectPoint(eye, WATER_N, 0),
    center: reflectPoint(center, WATER_N, 0),
    // reflect the up direction: d - 2(d·n)n
    up: [up[0], -up[1], up[2]],
  };
  state.clipView = clipView;
  state.reflVP = { proj: mProj, view: mView };
  state.footprint = waterFootprint(
    (p) => projectToUV(mProj, mView, p), state.water.corners);
}

function modelMat(pos, s) {
  const m = new Float32Array(16);
  m[0] = s[0]; m[5] = s[1]; m[10] = s[2]; m[15] = 1;
  m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2];
  return m;
}

function drawObjects(state, proj, view) {
  const { gl } = state;
  const p = state.progs.scene;
  gl.useProgram(p.prog);
  gl.uniformMatrix4fv(p.uniforms.uProj, false, proj);
  gl.uniformMatrix4fv(p.uniforms.uView, false, view);
  gl.uniform1f(p.uniforms.uAlpha, 1);
  for (const o of state.objects) {
    gl.uniformMatrix4fv(p.uniforms.uModel, false, modelMat(o.pos, o.s));
    gl.uniform3fv(p.uniforms.uColor, o.color);
    gl.bindVertexArray(o.mesh.vao);
    gl.drawElements(gl.TRIANGLES, o.mesh.count, gl.UNSIGNED_SHORT, 0);
  }
}

function renderReflection(state, t) {
  const { gl, target } = state;
  const cpu0 = performance.now();
  beginGpuTimer(state);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.viewport(0, 0, target.width, target.height);
  gl.clearColor(0.05, 0.07, 0.1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawObjects(state, state.mirror.proj, state.mirror.view);
  endGpuTimer(state);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  state.timing.cpuMs = performance.now() - cpu0;
}

function renderMain(state, t) {
  const { gl, cam } = state;
  gl.viewport(0, 0, state.canvas.width, state.canvas.height);
  gl.clearColor(0.09, 0.12, 0.17, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawObjects(state, cam.proj, cam.view);

  const p = state.progs.water;
  gl.useProgram(p.prog);
  gl.uniformMatrix4fv(p.uniforms.uProj, false, cam.proj);
  gl.uniformMatrix4fv(p.uniforms.uView, false, cam.view);
  gl.uniformMatrix4fv(p.uniforms.uReflVP, false,
    multiply4(state.reflVP.proj, state.reflVP.view));
  gl.uniform2fv(p.uniforms.uFpMin, state.footprint.min);
  gl.uniform2fv(p.uniforms.uFpMax, state.footprint.max);
  gl.uniform3fv(p.uniforms.uCamPos, cam.eye);
  gl.uniform1f(p.uniforms.uTime, t);
  gl.uniform1f(p.uniforms.uStrength, 0.08);
  gl.uniform1i(p.uniforms.uPerturb, state.perturb ? 1 : 0);
  gl.uniform1i(p.uniforms.uClamp, state.clamp ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.target.tex);
  gl.uniform1i(p.uniforms.uRefl, 0);
  gl.bindVertexArray(state.meshes.water.vao);
  gl.drawElements(gl.TRIANGLES, state.meshes.water.count, gl.UNSIGNED_SHORT, 0);
}

function multiply4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function beginGpuTimer(state) {
  const { gl, timerExt, timer } = state;
  if (!timerExt || timer.pending) return;
  timer.query = gl.createQuery();
  gl.beginQuery(timerExt.TIME_ELAPSED_EXT, timer.query);
}

function endGpuTimer(state) {
  const { gl, timerExt, timer } = state;
  if (!timerExt || !timer.query) return;
  gl.endQuery(timerExt.TIME_ELAPSED_EXT);
  timer.pending = true;
}

function pollGpuTimer(state) {
  const { gl, timerExt, timer } = state;
  if (!timerExt || !timer.pending || !timer.query) return;
  const available = gl.getQueryParameter(timer.query, gl.QUERY_RESULT_AVAILABLE);
  const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
  if (available && !disjoint) {
    state.timing.gpuMs = gl.getQueryParameter(timer.query, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(timer.query);
    timer.query = null;
    timer.pending = false;
  } else if (available) {
    gl.deleteQuery(timer.query);
    timer.query = null;
    timer.pending = false;
  }
}

function updateMetrics(state, t) {
  pollGpuTimer(state);
  const { proj, view } = state.reflVP;
  const projectUV = (p) => projectToUV(proj, view, p);
  const base = {
    projectUV, corners: state.water.corners,
    res: [state.target.width, state.target.height],
    time: t, strength: 0.08,
  };
  state.errOn = reflectionError({ ...base, perturb: true });
  state.errOff = reflectionError({ ...base, perturb: false });

  // clip-direction check for the sphere crossing the water plane
  const sphere = state.objects[4];
  const side = planeSide(sphere.pos, WATER_N, CLIP_D);
  const radius = sphere.s[1] / 2;
  state.clipCheck = {
    center: side,
    radius,
    keptPart: side + radius > 0,
    clippedPart: side - radius < 0,
    cameraSide: planeSide(state.cam.eye, WATER_N, CLIP_D) > 0 ? 'above' : 'below',
    mirrorSide: state.clipView.d < 0 ? 'negative (ok)' : 'POSITIVE (bad)',
  };
}

function attachOrbit(canvas, state) {
  let px = 0;
  canvas.addEventListener('pointerdown', (e) => {
    state.orbit.drag = true;
    px = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state.orbit.drag) return;
    state.orbit.angle += (e.clientX - px) * 0.008;
    px = e.clientX;
  });
  canvas.addEventListener('pointerup', () => { state.orbit.drag = false; });
  addEventListener('wheel', (e) => {
    state.orbit.height = Math.min(12, Math.max(0.4,
      state.orbit.height + Math.sign(e.deltaY) * 0.4));
  });
}
