// Dependency-free WebGL renderer for rigid-fold preview.
// Draws filled panel triangles, crease/edge lines and arrow gizmos with a
// single simple shader pair.

import { perspective, lookAt, multiply } from './mat4.js';

const VERT = `
attribute vec3 aPosition;
attribute vec3 aColor;
attribute vec3 aNormal;
uniform mat4 uViewProj;
varying vec3 vColor;
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vColor = aColor;
  vWorldPos = aPosition;
  vNormal = aNormal;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec3 vColor;
varying vec3 vWorldPos;
varying vec3 vNormal;
uniform vec3 uCamera;
void main() {
  vec3 n = normalize(vNormal);
  float facing = abs(dot(normalize(uCamera - vWorldPos), n));
  float shade = 0.62 + 0.38 * facing;
  gl_FragColor = vec4(vColor * shade, 1.0);
}
`;

const LINE_FRAG = `
precision mediump float;
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function program(gl, vsSource, fsSource) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSource));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p));
  }
  return p;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL');
    this.gl = gl;
    this.fillProgram = program(gl, VERT, FRAG);
    this.lineProgram = program(gl, VERT, LINE_FRAG);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.07, 0.08, 0.1, 1);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  makeBuffer(data) {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    return buffer;
  }

  draw(viewProj, camera, fillData, lineData) {
    const gl = this.gl;
    this.resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (fillData && fillData.positions.length) {
      this.drawArrays(this.fillProgram, viewProj, camera, fillData, gl.TRIANGLES);
    }
    if (lineData && lineData.positions.length) {
      this.drawArrays(this.lineProgram, viewProj, camera, lineData, gl.LINES);
    }
  }

  drawArrays(programId, viewProj, camera, data, mode) {
    const gl = this.gl;
    gl.useProgram(programId);
    const posLoc = gl.getAttribLocation(programId, 'aPosition');
    const colLoc = gl.getAttribLocation(programId, 'aColor');
    const normLoc = gl.getAttribLocation(programId, 'aNormal');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.makeBuffer(data.positions));
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.makeBuffer(data.colors));
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 3, gl.FLOAT, false, 0, 0);
    const normalBuffer = this.makeBuffer(
      data.normals ?? new Float32Array((data.positions.length / 3) * 3),
    );
    if (normLoc !== -1) {
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.enableVertexAttribArray(normLoc);
      gl.vertexAttribPointer(normLoc, 3, gl.FLOAT, false, 0, 0);
    }
    gl.uniformMatrix4fv(
      gl.getUniformLocation(programId, 'uViewProj'),
      false,
      viewProj,
    );
    const camLoc = gl.getUniformLocation(programId, 'uCamera');
    if (camLoc !== -1) gl.uniform3fv(camLoc, camera);
    gl.drawArrays(mode, 0, data.positions.length / 3);
  }

  frameMatrix(camera) {
    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
    const proj = perspective(Math.PI / 4, aspect, 0.01, 100);
    const view = lookAt(camera.eye, camera.target, [0, 0, 1]);
    return multiply(proj, view);
  }
}
