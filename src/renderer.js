const FILL_VERTEX = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in float aDistance;
uniform mat4 uViewProjection;
out vec3 vNormal;
out float vDistance;
out vec3 vWorld;
void main() {
  vNormal = aNormal;
  vDistance = aDistance;
  vWorld = aPosition;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

const FILL_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vDistance;
in vec3 vWorld;
uniform float uMaxDistance;
uniform float uBandCount;
uniform float uUseBands;
out vec4 outColor;

vec3 palette(float x) {
  vec3 c0 = vec3(0.953, 0.851, 0.643);
  vec3 c1 = vec3(0.851, 0.706, 0.463);
  vec3 c2 = vec3(0.612, 0.651, 0.424);
  vec3 c3 = vec3(0.353, 0.580, 0.459);
  vec3 c4 = vec3(0.239, 0.482, 0.475);
  vec3 c5 = vec3(0.153, 0.310, 0.365);
  vec3 c6 = vec3(0.102, 0.204, 0.259);
  float t = clamp(x, 0.0, 1.0) * 6.0;
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  if (t < 4.0) return mix(c3, c4, t - 3.0);
  if (t < 5.0) return mix(c4, c5, t - 4.0);
  return mix(c5, c6, t - 5.0);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(vec3(-0.38, 0.82, 0.42));
  float diffuse = 0.65 + 0.35 * abs(dot(normal, lightDir));
  if (vDistance < -0.5) {
    float hatch = step(0.73, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));
    vec3 neutral = vec3(0.115, 0.145, 0.155) + hatch * 0.012;
    outColor = vec4(neutral * diffuse, 1.0);
    return;
  }
  float normalized = clamp(vDistance / max(uMaxDistance, 1e-5), 0.0, 1.0);
  vec3 color;
  if (uUseBands > 0.5) {
    float scaled = normalized * uBandCount;
    float band = floor(scaled);
    float fraction = fract(scaled);
    color = palette((band + 0.5) / uBandCount);
    float width = max(fwidth(scaled) * 1.1, 0.012);
    float edge = min(fraction, 1.0 - fraction);
    float line = 1.0 - smoothstep(0.0, width, edge);
    color = mix(color, color * 0.52 + vec3(0.018, 0.027, 0.03), line * 0.42);
  } else {
    color = palette(normalized);
  }
  float rim = pow(1.0 - abs(dot(normal, normalize(vec3(0.2, 0.3, 1.0)))), 2.0);
  color += vec3(0.025, 0.034, 0.032) * rim;
  outColor = vec4(color * diffuse, 1.0);
}`;

const LINE_VERTEX = `#version 300 es
precision highp float;
in vec3 aPosition;
uniform mat4 uViewProjection;
void main() {
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function program(gl, vertexSource, fragmentSource) {
  const result = gl.createProgram();
  gl.attachShader(result, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(result, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(result);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(result));
  }
  return result;
}

function multiply(a, b) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let inner = 0; inner < 4; inner += 1) {
        value += a[inner * 4 + row] * b[column * 4 + inner];
      }
      result[column * 4 + row] = value;
    }
  }
  return result;
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / Math.max(length, 1e-12));
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export class MeshRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false
    });
    if (!gl) throw new Error("当前浏览器不支持 WebGL2");
    this.gl = gl;
    this.fillProgram = program(gl, FILL_VERTEX, FILL_FRAGMENT);
    this.lineProgram = program(gl, LINE_VERTEX, LINE_FRAGMENT);
    this.fillUniforms = {
      viewProjection: gl.getUniformLocation(this.fillProgram, "uViewProjection"),
      maxDistance: gl.getUniformLocation(this.fillProgram, "uMaxDistance"),
      bandCount: gl.getUniformLocation(this.fillProgram, "uBandCount"),
      useBands: gl.getUniformLocation(this.fillProgram, "uUseBands")
    };
    this.lineUniforms = {
      viewProjection: gl.getUniformLocation(this.lineProgram, "uViewProjection"),
      color: gl.getUniformLocation(this.lineProgram, "uColor")
    };
    this.mesh = null;
    this.bands = true;
    this.bandCount = 9;
    this.wire = false;
    this.maxDistance = 1;
    this.yaw = -0.32;
    this.pitch = 0.45;
    this.distance = 3.9;
    this.target = [0, 0, 0];
    this.autoRotate = false;
    this.lastProjection = null;
    this.viewport = { width: 1, height: 1, dpr: 1 };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    this._updateCamera();
  }

  setMesh(mesh) {
    const gl = this.gl;
    this.mesh = mesh;
    this.maxDistance = Math.max(mesh.averageEdge, 0.1);
    this._deleteGeometry();
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.positions), gl.STATIC_DRAW);

    this.normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertexNormals), gl.STATIC_DRAW);

    this.distanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.distanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertexCount).fill(-1), gl.DYNAMIC_DRAW);

    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.triangles, gl.STATIC_DRAW);

    const lineIndices = new Uint32Array(mesh.edgeFaces.size * 2);
    let lineOffset = 0;
    for (const edge of mesh.edgeFaces.keys()) {
      const [a, b] = edge.split(":").map(Number);
      lineIndices[lineOffset] = a;
      lineIndices[lineOffset + 1] = b;
      lineOffset += 2;
    }
    this.lineBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIndices, gl.STATIC_DRAW);
    this.lineCount = lineIndices.length;

    const fillPosition = gl.getAttribLocation(this.fillProgram, "aPosition");
    const fillNormal = gl.getAttribLocation(this.fillProgram, "aNormal");
    const fillDistance = gl.getAttribLocation(this.fillProgram, "aDistance");
    this.fillVao = gl.createVertexArray();
    gl.bindVertexArray(this.fillVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(fillPosition);
    gl.vertexAttribPointer(fillPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.enableVertexAttribArray(fillNormal);
    gl.vertexAttribPointer(fillNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.distanceBuffer);
    gl.enableVertexAttribArray(fillDistance);
    gl.vertexAttribPointer(fillDistance, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

    const linePosition = gl.getAttribLocation(this.lineProgram, "aPosition");
    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(linePosition);
    gl.vertexAttribPointer(linePosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineBuffer);
    gl.bindVertexArray(null);
    this.resetCamera(mesh.kind);
  }

  _deleteGeometry() {
    const gl = this.gl;
    for (const name of [
      "positionBuffer", "normalBuffer", "distanceBuffer", "indexBuffer",
      "lineBuffer", "fillVao", "lineVao"
    ]) {
      if (!this[name]) continue;
      if (name.endsWith("Vao")) gl.deleteVertexArray(this[name]);
      else gl.deleteBuffer(this[name]);
      this[name] = null;
    }
  }

  resetCamera(kind) {
    this.autoRotate = false;
    if (kind === "sphere") {
      this.yaw = 0.35;
      this.pitch = 0.14;
      this.distance = 4.7;
    } else if (kind === "disconnected") {
      this.yaw = -0.18;
      this.pitch = 0.36;
      this.distance = 3.95;
    } else {
      this.yaw = -0.32;
      this.pitch = 0.45;
      this.distance = 3.82;
    }
    this.target = [0, 0, 0];
    this._updateCamera();
  }

  updateDistances(result) {
    if (!this.mesh || !this.distanceBuffer) return;
    const values = new Float32Array(this.mesh.vertexCount);
    let maximum = 0;
    for (let vertex = 0; vertex < this.mesh.vertexCount; vertex += 1) {
      const distance = result.distances[vertex];
      if (result.reachable[vertex] && Number.isFinite(distance)) {
        values[vertex] = distance;
        maximum = Math.max(maximum, distance);
      } else {
        values[vertex] = -1;
      }
    }
    this.maxDistance = Math.max(maximum, this.mesh.averageEdge * 0.5);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.distanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, values);
  }

  clearDistances() {
    if (!this.distanceBuffer || !this.mesh) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.distanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(this.mesh.vertexCount).fill(-1));
  }

  setBandSettings(enabled, count) {
    this.bands = enabled;
    this.bandCount = Math.max(2, count);
  }

  setWire(enabled) {
    this.wire = enabled;
  }

  rotate(deltaX, deltaY) {
    this.autoRotate = false;
    this.yaw -= deltaX * 0.008;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + deltaY * 0.006));
    this._updateCamera();
  }

  zoom(delta) {
    this.distance = Math.max(2.2, Math.min(8.5, this.distance * Math.exp(delta * 0.0012)));
    this._updateCamera();
  }

  _updateCamera() {
    const cosine = Math.cos(this.pitch);
    const eye = [
      this.target[0] + cosine * Math.sin(this.yaw) * this.distance,
      this.target[1] + Math.sin(this.pitch) * this.distance,
      this.target[2] + cosine * Math.cos(this.yaw) * this.distance
    ];
    const forward = normalize(subtract(this.target, eye));
    const right = normalize(cross(forward, [0, 1, 0]));
    const up = normalize(cross(right, forward));
    this.camera = { eye, forward, right, up };
    const view = new Float32Array([
      right[0], up[0], -forward[0], 0,
      right[1], up[1], -forward[1], 0,
      right[2], up[2], -forward[2], 0,
      -dot(right, eye), -dot(up, eye), dot(forward, eye), 1
    ]);
    const aspect = this.viewport.width / Math.max(1, this.viewport.height);
    const near = 0.04;
    const far = 60;
    const f = 1 / Math.tan((38 * Math.PI / 180) / 2);
    const projection = new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0
    ]);
    this.lastProjection = multiply(projection, view);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.viewport = { width: rect.width, height: rect.height, dpr };
    this._updateCamera();
    return this.viewport;
  }

  render() {
    const gl = this.gl;
    this.resize();
    if (this.autoRotate) {
      this.yaw += 0.0024;
      this._updateCamera();
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.mesh) return;
    gl.useProgram(this.fillProgram);
    gl.uniformMatrix4fv(this.fillUniforms.viewProjection, false, this.lastProjection);
    gl.uniform1f(this.fillUniforms.maxDistance, this.maxDistance);
    gl.uniform1f(this.fillUniforms.bandCount, this.bandCount);
    gl.uniform1f(this.fillUniforms.useBands, this.bands ? 1 : 0);
    gl.bindVertexArray(this.fillVao);
    gl.drawElements(gl.TRIANGLES, this.mesh.triangles.length, gl.UNSIGNED_INT, 0);
    if (this.wire) {
      gl.useProgram(this.lineProgram);
      gl.uniformMatrix4fv(this.lineUniforms.viewProjection, false, this.lastProjection);
      gl.uniform4f(this.lineUniforms.color, 0.035, 0.055, 0.06, 0.72);
      gl.bindVertexArray(this.lineVao);
      gl.drawElements(gl.LINES, this.lineCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  project(point) {
    if (!this.lastProjection) return null;
    const matrix = this.lastProjection;
    const x = point[0];
    const y = point[1];
    const z = point[2];
    const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
    const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (clipW <= 1e-6) return null;
    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    return {
      x: (ndcX * 0.5 + 0.5) * this.viewport.width,
      y: (1 - (ndcY * 0.5 + 0.5)) * this.viewport.height,
      depth: clipZ / clipW
    };
  }

  rayFromScreen(screenX, screenY) {
    const aspect = this.viewport.width / Math.max(1, this.viewport.height);
    const ndcX = screenX / this.viewport.width * 2 - 1;
    const ndcY = 1 - screenY / this.viewport.height * 2;
    const tangent = Math.tan((38 * Math.PI / 180) / 2);
    const { eye, forward, right, up } = this.camera;
    const direction = normalize([
      forward[0] + right[0] * ndcX * tangent * aspect + up[0] * ndcY * tangent,
      forward[1] + right[1] * ndcX * tangent * aspect + up[1] * ndcY * tangent,
      forward[2] + right[2] * ndcX * tangent * aspect + up[2] * ndcY * tangent
    ]);
    return { origin: eye, direction };
  }

  pickAt(screenX, screenY) {
    if (!this.mesh) return null;
    const { origin, direction } = this.rayFromScreen(screenX, screenY);
    const mesh = this.mesh;
    let best = null;
    for (let face = 0; face < mesh.faceCount; face += 1) {
      const [a, b, c] = mesh.face(face);
      const pa = mesh.point(a);
      const pb = mesh.point(b);
      const pc = mesh.point(c);
      const edge1 = subtract(pb, pa);
      const edge2 = subtract(pc, pa);
      const h = cross(direction, edge2);
      const determinant = dot(edge1, h);
      if (Math.abs(determinant) < 1e-10) continue;
      const inverse = 1 / determinant;
      const s = subtract(origin, pa);
      const u = inverse * dot(s, h);
      if (u < -1e-5 || u > 1.00005) continue;
      const q = cross(s, edge1);
      const v = inverse * dot(direction, q);
      if (v < -1e-5 || u + v > 1.00005) continue;
      const t = inverse * dot(edge2, q);
      if (t <= 1e-6 || (best && t >= best.t)) continue;
      best = { t, face, point: [
        origin[0] + direction[0] * t,
        origin[1] + direction[1] * t,
        origin[2] + direction[2] * t
      ] };
    }
    if (!best) return null;
    let vertex = -1;
    let nearest = Infinity;
    for (const candidate of mesh.face(best.face)) {
      const point = mesh.point(candidate);
      const distance = (
        (point[0] - best.point[0]) ** 2 +
        (point[1] - best.point[1]) ** 2 +
        (point[2] - best.point[2]) ** 2
      );
      if (distance < nearest) {
        nearest = distance;
        vertex = candidate;
      }
    }
    return { vertex, face: best.face, point: best.point };
  }
}
