// Debug picture-in-picture: overview camera showing the main camera frustum
// (cyan), the mirror camera frustum (yellow) and the oblique clip plane
// (red square + normal arrow toward the kept side).

import { perspective, lookAt } from './math.mjs';
import { frustumLines } from './scene.mjs';

let lineVao = null;
let lineVbo = null;

export function renderDebugView(state) {
  const { gl, canvas } = state;
  if (!lineVao) {
    lineVao = gl.createVertexArray();
    lineVbo = gl.createBuffer();
    gl.bindVertexArray(lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  const w = Math.round(canvas.width * 0.38);
  const h = canvas.height;
  const x = canvas.width - w;
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x, 0, w, h);
  gl.viewport(x, 0, w, h);
  gl.clearColor(0.06, 0.08, 0.11, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const eye = [12, 8, 12];
  const proj = perspective(Math.PI / 3.2, w / h, 0.1, 200);
  const view = lookAt(eye, [0, -0.6, 0], [0, 1, 0]);

  // scene objects + translucent water surface for reference
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const sp = state.progs.scene;
  gl.useProgram(sp.prog);
  gl.uniformMatrix4fv(sp.uniforms.uProj, false, proj);
  gl.uniformMatrix4fv(sp.uniforms.uView, false, view);
  for (const o of state.objects) {
    gl.uniformMatrix4fv(sp.uniforms.uModel, false, modelMat(o.pos, o.s));
    gl.uniform3fv(sp.uniforms.uColor, o.color);
    gl.uniform1f(sp.uniforms.uAlpha, 1);
    gl.bindVertexArray(o.mesh.vao);
    gl.drawElements(gl.TRIANGLES, o.mesh.count, gl.UNSIGNED_SHORT, 0);
  }
  gl.uniformMatrix4fv(sp.uniforms.uModel, false, identity());
  gl.uniform3fv(sp.uniforms.uColor, [0.1, 0.35, 0.5]);
  gl.uniform1f(sp.uniforms.uAlpha, 0.25);
  gl.bindVertexArray(state.meshes.water.vao);
  gl.drawElements(gl.TRIANGLES, state.meshes.water.count, gl.UNSIGNED_SHORT, 0);
  gl.disable(gl.BLEND);

  // frustum + clip-plane lines
  const cam = state.cam;
  const mir = state.mirror;
  const mainFr = frustumLines(cam.eye, cam.center, cam.up, Math.PI / 3.6,
    canvas.width / canvas.height, 0.3, 4);
  const mirFr = frustumLines(mir.eye, mir.center, mir.up, Math.PI / 3.6,
    canvas.width / canvas.height, 0.3, 4);
  const y = 0.02; // clip plane y = -CLIP_D
  const s = 2.2;
  const clipSq = [
    -s, y, -s, s, y, -s, s, y, -s, s, y, s,
    s, y, s, -s, y, s, -s, y, s, -s, y, -s,
  ];
  const arrow = [0, y, 0, 0, y + 1.4, 0];

  const lp = state.progs.line;
  gl.useProgram(lp.prog);
  gl.uniformMatrix4fv(lp.uniforms.uProj, false, proj);
  gl.uniformMatrix4fv(lp.uniforms.uView, false, view);
  drawLines(gl, lineVao, lineVbo, lp, mainFr, [0.2, 0.9, 1.0]);
  drawLines(gl, lineVao, lineVbo, lp, mirFr, [1.0, 0.85, 0.2]);
  drawLines(gl, lineVao, lineVbo, lp, clipSq, [1.0, 0.25, 0.25]);
  drawLines(gl, lineVao, lineVbo, lp, arrow, [1.0, 0.25, 0.25]);

  gl.disable(gl.SCISSOR_TEST);
}

function drawLines(gl, vao, vbo, prog, positions, color) {
  gl.useProgram(prog.prog);
  gl.uniform3fv(prog.uniforms.uColor, color);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
  gl.drawArrays(gl.LINES, 0, positions.length / 3);
}

function modelMat(pos, s) {
  const m = new Float32Array(16);
  m[0] = s[0]; m[5] = s[1]; m[10] = s[2]; m[15] = 1;
  m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2];
  return m;
}

function identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
