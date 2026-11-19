import { SlotPool } from "./slot-pool.js";
import {
  RENDER_FRAGMENT_SHADER,
  RENDER_VERTEX_SHADER,
  SIMULATION_FRAGMENT_SHADER,
  SIMULATION_VERTEX_SHADER,
} from "./shaders.js";

const FLOATS_PER_PARTICLE = 13;
const STRIDE_BYTES = FLOATS_PER_PARTICLE * Float32Array.BYTES_PER_ELEMENT;
const TF_VARYINGS = [
  "vPosition",
  "vVelocity",
  "vLife",
  "vColor",
  "vGeneration",
];

export class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: false,
      powerPreference: "high-performance",
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });

    if (!this.gl) {
      throw new Error("WebGL2 is not available");
    }

    this.pool = null;
    this.stateBuffers = [];
    this.stateVaos = [];
    this.current = 0;
    this.simTime = 0;
    this.tfDraws = 0;
    this.rngState = 0x9e3779b9;
    this.pointer = new Float32Array([0, 0]);
    this.pointerActive = 0;
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.lastDpr = 1;
    this.aspect = 1;

    this.transformFeedback = this.gl.createTransformFeedback();
    this.simProgram = this.createProgram(
      SIMULATION_VERTEX_SHADER,
      SIMULATION_FRAGMENT_SHADER,
      TF_VARYINGS,
    );
    this.renderProgram = this.createProgram(
      RENDER_VERTEX_SHADER,
      RENDER_FRAGMENT_SHADER,
    );

    this.simUniforms = this.getUniforms(this.simProgram, [
      "uDt",
      "uTime",
      "uPointer",
      "uPointerActive",
    ]);
    this.renderUniforms = this.getUniforms(this.renderProgram, [
      "uAspect",
      "uDpr",
    ]);

    this.resize();
  }

  createProgram(vertexSource, fragmentSource, varyings = null) {
    const gl = this.gl;
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    if (varyings) {
      gl.transformFeedbackVaryings(program, varyings, gl.INTERLEAVED_ATTRIBS);
    }
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Could not link WebGL program: ${message}`);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`WebGL shader compilation failed: ${message}`);
    }

    return shader;
  }

  getUniforms(program, names) {
    const uniforms = {};
    for (const name of names) {
      uniforms[name] = this.gl.getUniformLocation(program, name);
    }
    return uniforms;
  }

  reset(capacity) {
    this.gl.bindVertexArray(null);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
    this.gl.bindBufferBase(this.gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

    for (const buffer of this.stateBuffers) this.gl.deleteBuffer(buffer);
    for (const vao of this.stateVaos) this.gl.deleteVertexArray(vao);

    this.stateBuffers = [];
    this.stateVaos = [];
    this.current = 0;
    this.simTime = 0;
    this.tfDraws = 0;
    this.rngState = 0x9e3779b9;
    this.pool = new SlotPool(capacity);
    this.createStateBuffers(capacity);
    this.warmup(4.2, 250);
  }

  createStateBuffers(capacity) {
    const gl = this.gl;
    const emptyState = new Float32Array(capacity * FLOATS_PER_PARTICLE);

    for (let bufferIndex = 0; bufferIndex < 2; bufferIndex += 1) {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, emptyState.byteLength, gl.DYNAMIC_COPY);

      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      this.configureAttributes(buffer);
      this.stateBuffers.push(buffer);
      this.stateVaos.push(vao);
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  configureAttributes(buffer) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE_BYTES, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE_BYTES, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, STRIDE_BYTES, 32);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, STRIDE_BYTES, 48);
  }

  random() {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let value = this.rngState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  sampleColor() {
    const roll = this.random();
    let color;

    if (roll < 0.58) {
      color = [0.31, 0.98, 0.8];
    } else if (roll < 0.88) {
      color = [0.33, 0.7, 1.0];
    } else {
      color = [1.0, 0.7, 0.34];
    }

    const energy = 0.9 + this.random() * 0.13;
    return [
      Math.min(1, color[0] * energy),
      Math.min(1, color[1] * energy),
      Math.min(1, color[2] * energy),
      this.random(),
    ];
  }

  emit(count) {
    if (!this.pool || count <= 0) return 0;

    const records = [];
    for (let index = 0; index < count; index += 1) {
      const lifetime = 4.25 + this.random() * 2.8;
      const slot = this.pool.spawn(this.simTime, lifetime);
      if (!slot) continue;

      const color = this.sampleColor();
      records.push({
        index: slot.index,
        generation: slot.generation,
        lifetime,
        px: (this.random() - 0.5) * 0.085,
        py: -1.075 + this.random() * 0.03,
        pz: (this.random() - 0.5) * 0.9,
        vx: (this.random() - 0.5) * 0.23,
        vy: 0.47 + this.random() * 0.58,
        vz: (this.random() - 0.5) * 0.26,
        color,
      });
    }

    if (records.length > 0) this.writeSpawnBatch(records);
    return records.length;
  }

  writeSpawnBatch(records) {
    const gl = this.gl;
    records.sort((left, right) => left.index - right.index);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBuffers[this.current]);

    let start = 0;
    while (start < records.length) {
      let end = start + 1;
      while (
        end < records.length &&
        records[end].index === records[end - 1].index + 1
      ) {
        end += 1;
      }

      const runLength = end - start;
      const data = new Float32Array(runLength * FLOATS_PER_PARTICLE);
      for (let recordIndex = 0; recordIndex < runLength; recordIndex += 1) {
        const record = records[start + recordIndex];
        const offset = recordIndex * FLOATS_PER_PARTICLE;
        data[offset] = record.px;
        data[offset + 1] = record.py;
        data[offset + 2] = record.pz;
        data[offset + 3] = record.vx;
        data[offset + 4] = record.vy;
        data[offset + 5] = record.vz;
        data[offset + 6] = record.lifetime;
        data[offset + 7] = record.lifetime;
        data[offset + 8] = record.color[0];
        data[offset + 9] = record.color[1];
        data[offset + 10] = record.color[2];
        data[offset + 11] = record.color[3];
        data[offset + 12] = record.generation;
      }

      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        records[start].index * STRIDE_BYTES,
        data,
      );
      start = end;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  step(dt) {
    if (!this.pool) return;

    const gl = this.gl;
    const delta = Math.min(Math.max(dt, 0), 0.05);
    const source = this.current;
    const destination = source ^ 1;

    gl.useProgram(this.simProgram);
    gl.uniform1f(this.simUniforms.uDt, delta);
    gl.uniform1f(this.simUniforms.uTime, this.simTime);
    gl.uniform2fv(this.simUniforms.uPointer, this.pointer);
    gl.uniform1f(this.simUniforms.uPointerActive, this.pointerActive);

    gl.bindVertexArray(this.stateVaos[source]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedback);
    gl.bindBufferBase(
      gl.TRANSFORM_FEEDBACK_BUFFER,
      0,
      this.stateBuffers[destination],
    );
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.pool.capacity);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);

    this.current = destination;
    this.simTime += delta;
    this.pool.expire(this.simTime);
    this.tfDraws += 1;
  }

  warmup(seconds, particlesPerSecond) {
    if (!this.pool) return;

    const step = 1 / 60;
    const frameCount = Math.floor(seconds / step);
    let emissionAccumulator = 0;

    for (let frame = 0; frame < frameCount; frame += 1) {
      emissionAccumulator += particlesPerSecond * step;
      const emissionCount = Math.floor(emissionAccumulator);
      emissionAccumulator -= emissionCount;
      this.emit(emissionCount);
      this.step(step);
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));

    if (
      this.lastWidth !== width ||
      this.lastHeight !== height ||
      this.lastDpr !== dpr
    ) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.lastWidth = width;
      this.lastHeight = height;
      this.lastDpr = dpr;
      this.aspect = width / height;
      this.gl.viewport(0, 0, width, height);
    }

    return dpr;
  }

  render() {
    if (!this.pool) return;

    const gl = this.gl;
    const dpr = this.resize();

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.renderProgram);
    gl.uniform1f(this.renderUniforms.uAspect, this.aspect);
    gl.uniform1f(this.renderUniforms.uDpr, dpr);
    gl.bindVertexArray(this.stateVaos[this.current]);
    gl.drawArrays(gl.POINTS, 0, this.pool.capacity);
    gl.bindVertexArray(null);
  }

  setPointer(x, y, active) {
    this.pointer[0] = x;
    this.pointer[1] = y;
    this.pointerActive = active ? 1 : 0;
  }

  clearPointer() {
    this.pointerActive = 0;
  }

  snapshot(now = this.simTime) {
    return {
      ...this.pool.snapshot(now),
      simTime: this.simTime,
      current: this.current,
      tfDraws: this.tfDraws,
      stateBytes: this.pool.capacity * STRIDE_BYTES,
    };
  }
}
