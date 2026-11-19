import { invert, multiply } from "./math.mjs";
import { createScene } from "./scene.mjs";
import { shaderModules } from "./shaders.mjs";

const SHADOW_SIZE = 2048;
const UNIFORM_BYTES = 336;
const DEBUG_VIEWS = { final: 0, scene: 1, half: 2, weights: 3, shadow: 4, guided: 5 };

export class VolumetricRenderer {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.device = null;
    this.context = null;
    this.width = 1;
    this.height = 1;
    this.halfWidth = 1;
    this.halfHeight = 1;
    this.scene = null;
    this.textures = null;
    this.bindGroups = null;
    this.uniformData = new Float32Array(UNIFORM_BYTES / 4);
    this.startTime = performance.now();
    this.destroyed = false;
  }

  async init() {
    if (!navigator.gpu) {
      throw new Error("当前浏览器未提供 navigator.gpu。请使用支持 WebGPU 的最新版 Chrome/Edge。");
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("无法获取 WebGPU adapter。");
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      if (!this.destroyed) console.error("WebGPU device lost:", info.message);
    });

    this.context = this.canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    this.createPipelines();
    this.createGeometry();
    this.uniformBuffer = this.device.createBuffer({
      label: "shared uniforms",
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shadowSampler = this.device.createSampler({
      label: "shadow comparison sampler",
      compare: "less",
      magFilter: "linear",
      minFilter: "linear",
    });
    this.shadowTexture = this.createTexture(
      "spot shadow depth",
      "depth32float",
      [SHADOW_SIZE, SHADOW_SIZE],
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    );
    this.shadowView = this.shadowTexture.createView();
    this.resize();
    this.render();
  }

  createPipelines() {
    const device = this.device;
    const modules = {};
    for (const [name, code] of Object.entries(shaderModules)) {
      modules[name] = device.createShaderModule({ label: `${name} shader`, code });
    }
    this.modules = modules;

    const vertexLayout = {
      arrayStride: 40,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x3" },
        { shaderLocation: 3, offset: 36, format: "float32" },
      ],
    };
    const depthState = {
      format: "depth32float",
      depthWriteEnabled: true,
      depthCompare: "less",
    };

    this.shadowPipeline = device.createRenderPipeline({
      label: "spot shadow",
      layout: "auto",
      vertex: {
        module: modules.shadow,
        entryPoint: "vsMain",
        buffers: [vertexLayout],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less",
        depthBias: 2,
        depthBiasSlopeScale: 2.0,
      },
    });

    this.scenePipeline = device.createRenderPipeline({
      label: "opaque scene",
      layout: "auto",
      vertex: {
        module: modules.scene,
        entryPoint: "vsMain",
        buffers: [vertexLayout],
      },
      fragment: {
        module: modules.scene,
        entryPoint: "fsMain",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: depthState,
    });

    this.computePipeline = device.createComputePipeline({
      label: "half-resolution volume integration",
      layout: "auto",
      compute: { module: modules.volume, entryPoint: "main" },
    });

    this.compositePipeline = device.createRenderPipeline({
      label: "depth-guided composite",
      layout: "auto",
      vertex: { module: modules.composite, entryPoint: "vsMain" },
      fragment: {
        module: modules.composite,
        entryPoint: "fsMain",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  createGeometry() {
    this.scene = createScene(16, 9);
    const vertexBuffer = this.device.createBuffer({
      label: "scene vertices",
      size: Math.ceil(this.scene.vertices.byteLength / 4) * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, this.scene.vertices);
    const indexBuffer = this.device.createBuffer({
      label: "scene indices",
      size: Math.ceil(this.scene.indices.byteLength / 4) * 4,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(indexBuffer, 0, this.scene.indices);
    this.vertexBuffer = vertexBuffer;
    this.indexBuffer = indexBuffer;
  }

  createTexture(label, format, size, usage) {
    return this.device.createTexture({
      label,
      size: [size[0], size[1], 1],
      format,
      usage,
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const width = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (width === this.width && height === this.height && this.textures) return;
    this.width = width;
    this.height = height;
    this.halfWidth = Math.max(1, Math.floor(width / 2));
    this.halfHeight = Math.max(1, Math.floor(height / 2));
    this.canvas.width = width;
    this.canvas.height = height;
    this.rebuildTargets();
  }

  rebuildTargets() {
    if (this.textures) {
      for (const texture of Object.values(this.textures)) texture.destroy();
    }
    const sampled = GPUTextureUsage.TEXTURE_BINDING;
    this.textures = {
      sceneColor: this.createTexture(
        "full-res scene HDR",
        "rgba16float",
        [this.width, this.height],
        GPUTextureUsage.RENDER_ATTACHMENT | sampled,
      ),
      halfColor: this.createTexture(
        "half-res scene HDR",
        "rgba16float",
        [this.halfWidth, this.halfHeight],
        GPUTextureUsage.RENDER_ATTACHMENT | sampled,
      ),
      halfVolume: this.createTexture(
        "half-res volume",
        "rgba16float",
        [this.halfWidth, this.halfHeight],
        GPUTextureUsage.STORAGE_BINDING | sampled,
      ),
      fullDepth: this.createTexture(
        "full-res depth",
        "depth32float",
        [this.width, this.height],
        GPUTextureUsage.RENDER_ATTACHMENT | sampled,
      ),
      halfDepth: this.createTexture(
        "half-res depth",
        "depth32float",
        [this.halfWidth, this.halfHeight],
        GPUTextureUsage.RENDER_ATTACHMENT | sampled,
      ),
    };
    this.views = {
      sceneColor: this.textures.sceneColor.createView(),
      halfColor: this.textures.halfColor.createView(),
      halfVolume: this.textures.halfVolume.createView(),
      fullDepth: this.textures.fullDepth.createView(),
      halfDepth: this.textures.halfDepth.createView(),
    };
    this.makeBindGroups();
  }

  makeBindGroups() {
    const uniformEntry = { binding: 0, resource: { buffer: this.uniformBuffer } };
    this.shadowUniformGroup = this.device.createBindGroup({
      layout: this.shadowPipeline.getBindGroupLayout(0),
      entries: [uniformEntry],
    });
    this.sceneUniformGroup = this.device.createBindGroup({
      layout: this.scenePipeline.getBindGroupLayout(0),
      entries: [uniformEntry],
    });
    this.sceneShadowGroup = this.device.createBindGroup({
      layout: this.scenePipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.shadowView },
        { binding: 1, resource: this.shadowSampler },
      ],
    });
    this.volumeGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        uniformEntry,
        { binding: 1, resource: this.shadowView },
        { binding: 2, resource: this.shadowSampler },
        { binding: 3, resource: this.views.halfDepth },
        { binding: 4, resource: this.views.halfVolume },
      ],
    });
    this.compositeUniformGroup = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [uniformEntry],
    });
    this.compositeGroup = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.views.sceneColor },
        { binding: 1, resource: this.views.fullDepth },
        { binding: 2, resource: this.views.halfDepth },
        { binding: 3, resource: this.views.halfVolume },
        { binding: 4, resource: this.shadowView },
      ],
    });
  }

  updateUniforms() {
    const u = this.uniformData;
    const scene = this.scene;
    const camera = scene.camera;
    const light = scene.light;
    const s = this.settings;
    u.set(scene.viewProjection, 0);
    u.set(invert(scene.viewProjection), 16);
    u.set(light.viewProjection, 32);
    const time = s.dither ? (performance.now() - this.startTime) * 0.001 : 0.0;
    u.set([...camera.position, time], 48);
    u.set([...light.position, light.outerCos], 52);
    u.set([...light.direction, light.innerCos], 56);
    u.set([1.0, 0.82, 0.62, 190.0 * s.intensity], 60);
    u.set([this.width, this.height, this.halfWidth, this.halfHeight], 64);
    u.set([s.density, 0.28, s.steps, s.dither ? 1 : 0], 68);
    u.set([1.0, 0.28, 28.0, 1.12], 72);
    u.set([0.018, 0.028, 0.0, DEBUG_VIEWS[s.view] ?? 0], 76);
    u.set([SHADOW_SIZE, 0.0016, s.wdebug || 0.0, 0.025], 80);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);
  }

  render() {
    if (!this.device || !this.textures) return;
    this.resize();
    this.updateUniforms();
    const encoder = this.device.createCommandEncoder({ label: "frame" });

    const shadowPass = encoder.beginRenderPass({
      label: "spot shadow pass",
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.shadowView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    shadowPass.setPipeline(this.shadowPipeline);
    shadowPass.setBindGroup(0, this.shadowUniformGroup);
    shadowPass.setVertexBuffer(0, this.vertexBuffer);
    shadowPass.setIndexBuffer(this.indexBuffer, "uint32");
    shadowPass.drawIndexed(this.scene.indexCount);
    shadowPass.end();

    const scenePass = encoder.beginRenderPass({
      label: "full-resolution opaque pass",
      colorAttachments: [{
        view: this.views.sceneColor,
        clearValue: { r: 0.003, g: 0.004, b: 0.005, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
      depthStencilAttachment: {
        view: this.views.fullDepth,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    this.drawScene(scenePass);
    scenePass.end();

    const halfPass = encoder.beginRenderPass({
      label: "half-resolution depth pass",
      colorAttachments: [{
        view: this.views.halfColor,
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1 },
        loadOp: "clear",
        storeOp: "discard",
      }],
      depthStencilAttachment: {
        view: this.views.halfDepth,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    this.drawScene(halfPass);
    halfPass.end();

    const computePass = encoder.beginComputePass({ label: "volume integration" });
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.volumeGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(this.halfWidth / 8),
      Math.ceil(this.halfHeight / 8),
    );
    computePass.end();

    const canvasTexture = this.context.getCurrentTexture();
    const compositePass = encoder.beginRenderPass({
      label: "depth-guided composite",
      colorAttachments: [{
        view: canvasTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    compositePass.setPipeline(this.compositePipeline);
    compositePass.setBindGroup(0, this.compositeUniformGroup);
    compositePass.setBindGroup(1, this.compositeGroup);
    compositePass.draw(3);
    compositePass.end();

    if (this.capturePending) {
      const bytesPerRow = Math.ceil(this.width * 4 / 256) * 256;
      const readback = this.device.createBuffer({
        label: "capture readback",
        size: bytesPerRow * this.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      encoder.copyTextureToBuffer(
        { texture: canvasTexture },
        { buffer: readback, bytesPerRow, rowsPerImage: this.height },
        { width: this.width, height: this.height },
      );
      this.pendingReadback = { buffer: readback, bytesPerRow };
    }

    this.device.queue.submit([encoder.finish()]);
  }

  async capture() {
    if (!this.device) throw new Error("renderer is not initialized");
    this.capturePending = true;
    this.render();
    this.capturePending = false;
    const { buffer, bytesPerRow } = this.pendingReadback;
    this.pendingReadback = null;
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const tight = new Uint8Array(this.width * this.height * 4);
    for (let y = 0; y < this.height; y++) {
      tight.set(
        mapped.subarray(y * bytesPerRow, y * bytesPerRow + this.width * 4),
        y * this.width * 4,
      );
    }
    buffer.unmap();
    buffer.destroy();
    return {
      width: this.width,
      height: this.height,
      format: this.format,
      data: tight,
    };
  }

  drawScene(pass) {
    pass.setPipeline(this.scenePipeline);
    pass.setBindGroup(0, this.sceneUniformGroup);
    pass.setBindGroup(1, this.sceneShadowGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, "uint32");
    pass.drawIndexed(this.scene.indexCount);
  }

  destroy() {
    this.destroyed = true;
    if (this.textures) {
      for (const texture of Object.values(this.textures)) texture.destroy();
    }
    if (this.shadowTexture) this.shadowTexture.destroy();
    if (this.uniformBuffer) this.uniformBuffer.destroy();
  }
}
