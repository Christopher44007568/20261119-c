import { flattenMatrices } from "./skeleton.js";
import { lookAt, multiply, perspective } from "./math.js";

const VERTEX_SHADER = (boneCount) => `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aJoints;
layout(location = 3) in vec4 aWeights;

uniform mat4 uViewProjection;
uniform mat4 uBoneMatrices[${boneCount}];
uniform int uSelectedBone;
uniform bool uBindPose;

out vec3 vNormal;
out vec3 vWorldPosition;
out float vHighlight;

void main() {
  if (uBindPose) {
    float highlight = 0.0;
    for (int slot = 0; slot < 4; slot++) {
      if (aJoints[slot] == float(uSelectedBone)) {
        highlight += aWeights[slot];
      }
    }
    vNormal = aNormal;
    vWorldPosition = aPosition;
    vHighlight = clamp(highlight, 0.0, 1.0);
    gl_Position = uViewProjection * vec4(aPosition, 1.0);
    return;
  }

  vec4 skinnedPosition = vec4(0.0);
  vec3 skinnedNormal = vec3(0.0);
  float highlight = 0.0;
  float weightTotal = 0.0;

  for (int slot = 0; slot < 4; slot++) {
    float weight = aWeights[slot];
    if (weight <= 0.0) {
      continue;
    }
    int bone = int(aJoints[slot] + 0.5);
    mat4 skin = uBoneMatrices[bone];
    skinnedPosition += weight * (skin * vec4(aPosition, 1.0));
    mat3 normalFromSkin = transpose(inverse(mat3(skin)));
    skinnedNormal += weight * (normalFromSkin * aNormal);
    weightTotal += weight;
    if (bone == uSelectedBone) {
      highlight += weight;
    }
  }

  if (weightTotal <= 1e-8) {
    skinnedPosition = vec4(aPosition, 1.0);
    skinnedNormal = aNormal;
  }
  vWorldPosition = skinnedPosition.xyz;
  vNormal = normalize(skinnedNormal);
  vHighlight = clamp(highlight, 0.0, 1.0);
  gl_Position = uViewProjection * skinnedPosition;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vWorldPosition;
in float vHighlight;

uniform vec3 uCameraPosition;
uniform vec3 uBaseColor;
uniform bool uDebugEnabled;

out vec4 outColor;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDirection = normalize(vec3(-0.45, 0.8, 0.55));
  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  float diffuse = max(dot(normal, lightDirection), 0.0);
  float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);
  vec3 color = uBaseColor * (0.24 + 0.76 * diffuse);
  color += vec3(0.08, 0.16, 0.22) * rim;
  if (uDebugEnabled) {
    vec3 highlightColor = mix(vec3(0.12, 0.58, 0.82), vec3(1.0, 0.43, 0.08), smoothstep(0.05, 0.8, vHighlight));
    color = mix(color, highlightColor, vHighlight * 0.88);
  }
  outColor = vec4(color, 1.0);
}
`;

const LINE_VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aColor;
uniform mat4 uViewProjection;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;

const LINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  outColor = vec4(vColor, 1.0);
}
`;

export class SkinningRenderer {
  constructor(canvas, { mesh, boneCount, parentIndices }) {
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      throw new Error("WebGL2 is required for GPU skeletal skinning");
    }
    this.canvas = canvas;
    this.gl = gl;
    this.boneCount = boneCount;
    this.parentIndices = parentIndices;
    this.mesh = mesh;
    this.program = createProgram(gl, VERTEX_SHADER(boneCount), FRAGMENT_SHADER);
    this.lineProgram = createProgram(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
    this.uniforms = {
      viewProjection: gl.getUniformLocation(this.program, "uViewProjection"),
      boneMatrices: gl.getUniformLocation(this.program, "uBoneMatrices[0]"),
      selectedBone: gl.getUniformLocation(this.program, "uSelectedBone"),
      bindPose: gl.getUniformLocation(this.program, "uBindPose"),
      cameraPosition: gl.getUniformLocation(this.program, "uCameraPosition"),
      baseColor: gl.getUniformLocation(this.program, "uBaseColor"),
      debugEnabled: gl.getUniformLocation(this.program, "uDebugEnabled"),
    };
    this.lineUniforms = {
      viewProjection: gl.getUniformLocation(this.lineProgram, "uViewProjection"),
    };
    this.palette = new Float32Array(boneCount * 16);
    this.camera = {
      yaw: 0.42,
      pitch: 0.12,
      distance: 6.4,
      target: [0, 1.4, 0],
    };
    this.meshVao = this.createMeshVao(mesh);
    this.floorVao = this.createFloorVao();
    this.skeletonVao = this.createSkeletonVao();
    this.attachOrbitControls();
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  createMeshVao(mesh) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this.attributeBuffer(0, mesh.positions, 3, gl.FLOAT, false, 0);
    this.attributeBuffer(1, mesh.normals, 3, gl.FLOAT, false, 0);
    this.attributeBuffer(2, mesh.joints, 4, gl.UNSIGNED_SHORT, false, 0);
    this.attributeBuffer(3, mesh.weights, 4, gl.FLOAT, false, 0);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, indexCount: mesh.indices.length };
  }

  attributeBuffer(location, data, size, type, normalized, stride) {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, type, normalized, stride, 0);
  }

  createFloorVao() {
    const positions = [];
    const colors = [];
    for (let line = -3; line <= 3; line += 1) {
      const major = line === 0 ? 1 : 0;
      const color = major
        ? [0.24, 0.38, 0.48]
        : [0.085, 0.14, 0.19];
      positions.push(line, -0.25, -3, line, -0.25, 3);
      colors.push(...color, ...color);
      positions.push(-3, -0.25, line, 3, -0.25, line);
      colors.push(...color, ...color);
    }
    return this.createLineVao(positions, colors);
  }

  createSkeletonVao() {
    const vertexFloatCount = this.boneCount * 2 * 3;
    const positions = new Float32Array(vertexFloatCount);
    const colors = new Float32Array(vertexFloatCount);
    const vao = this.createLineVao(positions, colors, true);
    return { ...vao, positions, colors, positionBuffer: vao.positionBuffer };
  }

  createLineVao(positions, colors, dynamic = false) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(positions),
      dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(colors),
      dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return {
      vao,
      positionBuffer,
      colorBuffer,
      vertexCount: positions.length / 3,
    };
  }

  updateSkeleton(worlds, selectedBone) {
    const gl = this.gl;
    const positions = this.skeletonVao.positions;
    const colors = this.skeletonVao.colors;
    let vertex = 0;
    for (let bone = 0; bone < this.boneCount; bone += 1) {
      const parent = this.parentIndices[bone];
      if (parent < 0) {
        continue;
      }
      const start = [worlds[parent][12], worlds[parent][13], worlds[parent][14]];
      const end = [worlds[bone][12], worlds[bone][13], worlds[bone][14]];
      positions.set(start, vertex * 3);
      positions.set(end, (vertex + 1) * 3);
      const color = bone === selectedBone
        ? [1, 0.45, 0.08]
        : [0.15, 0.78, 0.88];
      colors.set(color, vertex * 3);
      colors.set(color, (vertex + 1) * 3);
      vertex += 2;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skeletonVao.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skeletonVao.colorBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors);
    this.skeletonVao.vertexCount = vertex;
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(this.canvas.clientWidth * ratio);
    const height = Math.floor(this.canvas.clientHeight * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
  }

  cameraMatrices() {
    const { yaw, pitch, distance, target } = this.camera;
    const horizontal = Math.cos(pitch) * distance;
    const eye = [
      target[0] + Math.sin(yaw) * horizontal,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.cos(yaw) * horizontal,
    ];
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const projection = perspective(Math.PI / 4, aspect, 0.1, 100);
    const view = lookAt(eye, target, [0, 1, 0]);
    return { eye, viewProjection: multiply(projection, view) };
  }

  render({ skinMatrices, worlds, selectedBone, debugEnabled, bindPose = false }) {
    const gl = this.gl;
    this.resize();
    const { eye, viewProjection } = this.cameraMatrices();
    gl.clearColor(0.022, 0.035, 0.055, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(this.lineUniforms.viewProjection, false, viewProjection);
    gl.bindVertexArray(this.floorVao.vao);
    gl.drawArrays(gl.LINES, 0, this.floorVao.vertexCount);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.viewProjection, false, viewProjection);
    gl.uniform3fv(this.uniforms.cameraPosition, eye);
    gl.uniform3f(this.uniforms.baseColor, 0.38, 0.58, 0.72);
    gl.uniform1i(this.uniforms.selectedBone, selectedBone);
    gl.uniform1i(this.uniforms.debugEnabled, debugEnabled ? 1 : 0);
    gl.uniform1i(this.uniforms.bindPose, bindPose ? 1 : 0);
    flattenMatrices(skinMatrices, this.palette);
    gl.uniformMatrix4fv(this.uniforms.boneMatrices, false, this.palette);
    gl.bindVertexArray(this.meshVao.vao);
    gl.drawElements(gl.TRIANGLES, this.meshVao.indexCount, gl.UNSIGNED_SHORT, 0);

    this.updateSkeleton(worlds, selectedBone);
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(this.lineUniforms.viewProjection, false, viewProjection);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.skeletonVao.vao);
    gl.drawArrays(gl.LINES, 0, this.skeletonVao.vertexCount);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }

  attachOrbitControls() {
    let dragging = false;
    let previousX = 0;
    let previousY = 0;
    this.canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      previousX = event.clientX;
      previousY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.classList.add("dragging");
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }
      this.camera.yaw -= (event.clientX - previousX) * 0.008;
      this.camera.pitch = Math.min(
        1.25,
        Math.max(-0.35, this.camera.pitch + (event.clientY - previousY) * 0.006),
      );
      previousX = event.clientX;
      previousY = event.clientY;
    });
    const stopDragging = () => {
      dragging = false;
      this.canvas.classList.remove("dragging");
    };
    this.canvas.addEventListener("pointerup", stopDragging);
    this.canvas.addEventListener("pointercancel", stopDragging);
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.camera.distance = Math.min(
        12,
        Math.max(3.4, this.camera.distance + event.deltaY * 0.004),
      );
    }, { passive: false });
  }
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}
