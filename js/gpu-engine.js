import {
  QUANTILE_PROBABILITIES,
  normalizeConfig,
} from "./core.js";
import {
  GLOBAL_HISTOGRAM_SHADER,
  MERGE_SHADER,
  PREFIX_SHADER,
  QUANTILE_SHADER,
  localHistogramShader,
} from "./gpu-shaders.js";

const GLOBAL_WORKGROUP_SIZE = 256;
const PARAM_BUFFER_BYTES = 32;
const INIT_TIMEOUT_MS = 3_500;

function withTimeout(promise, milliseconds, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label}超过 ${milliseconds} ms`));
    }, milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function makeParamBuffer(config, count, workgroups) {
  const buffer = new ArrayBuffer(PARAM_BUFFER_BYTES);
  const uints = new Uint32Array(buffer);
  const floats = new Float32Array(buffer);
  uints[0] = count >>> 0;
  uints[1] = config.bins;
  floats[2] = config.min;
  floats[3] = config.max;
  uints[4] = config.workgroupSize;
  uints[5] = workgroups;
  return buffer;
}

function quantilesToBins(values) {
  return Array.from(values, (value) =>
    value === 0xffffffff ? null : Number(value),
  );
}

class GpuEngine {
  constructor(device, adapterInfo) {
    this.device = device;
    this.adapterInfo = adapterInfo;
    this.pipelineCache = new Map();
  }

  describe() {
    const info = this.adapterInfo ?? {};
    const detail =
      info.description ||
      [info.vendor, info.architecture, info.device].filter(Boolean).join(" · ") ||
      "WebGPU device";
    return {
      kind: "webgpu",
      label: "WebGPU",
      name: detail,
      detail: "WGSL compute · float32 input",
    };
  }

  getPipeline(key, code) {
    if (!this.pipelineCache.has(key)) {
      const module = this.device.createShaderModule({
        label: `${key}-shader`,
        code,
      });
      this.pipelineCache.set(
        key,
        this.device.createComputePipelineAsync({
          label: `${key}-pipeline`,
          layout: "auto",
          compute: { module, entryPoint: "main" },
        }),
      );
    }
    return this.pipelineCache.get(key);
  }

  async run(snapshot) {
    const config = normalizeConfig(snapshot.config);
    const input = new Float32Array(snapshot.values);
    const count = input.length;
    const width = config.bins + 2;
    const workgroups =
      count === 0 ? 0 : Math.ceil(count / config.workgroupSize);
    const device = this.device;
    const queue = device.queue;
    const resources = [];

    const createBuffer = (label, bytes, usage) => {
      const buffer = device.createBuffer({
        label,
        size: Math.max(4, bytes),
        usage,
      });
      resources.push(buffer);
      return buffer;
    };

    const inputBuffer = createBuffer(
      "float-input",
      input.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    if (count > 0) {
      queue.writeBuffer(inputBuffer, 0, input);
    }

    const globalHistogram = createBuffer(
      "global-histogram",
      width * 4,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    );
    const localHistogram = createBuffer(
      "local-histogram",
      Math.max(1, workgroups * width) * 4,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    );
    const mergedHistogram = createBuffer(
      "merged-histogram",
      width * 4,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    );
    const globalCdf = createBuffer(
      "global-cdf",
      config.bins * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const localCdf = createBuffer(
      "local-cdf",
      config.bins * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const globalQuantiles = createBuffer(
      "global-quantiles",
      QUANTILE_PROBABILITIES.length * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const localQuantiles = createBuffer(
      "local-quantiles",
      QUANTILE_PROBABILITIES.length * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const params = createBuffer(
      "params",
      PARAM_BUFFER_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const paramData = makeParamBuffer(config, count, workgroups);
    queue.writeBuffer(params, 0, paramData);
    queue.writeBuffer(
      globalHistogram,
      0,
      new Uint32Array(width),
    );
    if (workgroups > 0) {
      queue.writeBuffer(
        localHistogram,
        0,
        new Uint32Array(workgroups * width),
      );
    }
    queue.writeBuffer(
      mergedHistogram,
      0,
      new Uint32Array(width),
    );

    const globalPipeline = await this.getPipeline(
      "global-histogram",
      GLOBAL_HISTOGRAM_SHADER,
    );
    const localPipeline = await this.getPipeline(
      `local-histogram-${config.workgroupSize}`,
      localHistogramShader(config.workgroupSize),
    );
    const mergePipeline = await this.getPipeline("merge", MERGE_SHADER);
    const prefixPipeline = await this.getPipeline("prefix", PREFIX_SHADER);
    const quantilePipeline = await this.getPipeline(
      "quantiles",
      QUANTILE_SHADER,
    );

    const globalHistogramGroup = device.createBindGroup({
      layout: globalPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: params } },
        { binding: 2, resource: { buffer: globalHistogram } },
      ],
    });
    const localHistogramGroup = device.createBindGroup({
      layout: localPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: params } },
        { binding: 2, resource: { buffer: localHistogram } },
      ],
    });
    const mergeGroup = device.createBindGroup({
      layout: mergePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: localHistogram } },
        { binding: 1, resource: { buffer: mergedHistogram } },
        { binding: 2, resource: { buffer: params } },
      ],
    });
    const makePrefixGroup = (counts, target) =>
      device.createBindGroup({
        layout: prefixPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: counts } },
          { binding: 1, resource: { buffer: target } },
          { binding: 2, resource: { buffer: params } },
        ],
      });
    const makeQuantileGroup = (cdf, target) =>
      device.createBindGroup({
        layout: quantilePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: cdf } },
          { binding: 1, resource: { buffer: target } },
          { binding: 2, resource: { buffer: params } },
        ],
      });

    const encoder = device.createCommandEncoder({
      label: "histogram-prefix-encoder",
    });
    const pass = encoder.beginComputePass({ label: "compute-passes" });
    if (count > 0) {
      pass.setPipeline(globalPipeline);
      pass.setBindGroup(0, globalHistogramGroup);
      pass.dispatchWorkgroups(Math.ceil(count / GLOBAL_WORKGROUP_SIZE));
    }
    if (workgroups > 0) {
      pass.setPipeline(localPipeline);
      pass.setBindGroup(0, localHistogramGroup);
      pass.dispatchWorkgroups(workgroups);
      pass.setPipeline(mergePipeline);
      pass.setBindGroup(0, mergeGroup);
      pass.dispatchWorkgroups(1);
    }
    pass.setPipeline(prefixPipeline);
    pass.setBindGroup(0, makePrefixGroup(globalHistogram, globalCdf));
    pass.dispatchWorkgroups(1);
    pass.setBindGroup(0, makePrefixGroup(mergedHistogram, localCdf));
    pass.dispatchWorkgroups(1);
    pass.setPipeline(quantilePipeline);
    pass.setBindGroup(0, makeQuantileGroup(globalCdf, globalQuantiles));
    pass.dispatchWorkgroups(1);
    pass.setBindGroup(0, makeQuantileGroup(localCdf, localQuantiles));
    pass.dispatchWorkgroups(1);
    pass.end();

    const segments = [
      { source: globalHistogram, elements: width },
      { source: localHistogram, elements: workgroups * width },
      { source: mergedHistogram, elements: width },
      { source: globalCdf, elements: config.bins },
      { source: localCdf, elements: config.bins },
      {
        source: globalQuantiles,
        elements: QUANTILE_PROBABILITIES.length,
      },
      {
        source: localQuantiles,
        elements: QUANTILE_PROBABILITIES.length,
      },
    ];
    let stagingBytes = 0;
    const layouts = segments.map((segment) => {
      const byteLength = Math.max(4, segment.elements * 4);
      const layout = { ...segment, offset: stagingBytes, byteLength };
      stagingBytes += byteLength;
      return layout;
    });
    const staging = createBuffer(
      "result-readback",
      stagingBytes,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    );
    for (const layout of layouts) {
      encoder.copyBufferToBuffer(
        layout.source,
        0,
        staging,
        layout.offset,
        layout.byteLength,
      );
    }

    const started = performance.now();
    try {
      queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const mapped = new Uint32Array(staging.getMappedRange());
      const read = (layout) =>
        mapped.slice(
          layout.offset / 4,
          layout.offset / 4 + layout.elements,
        );
      const result = {
        globalHistogram: read(layouts[0]),
        localHistogram: read(layouts[1]),
        mergedHistogram: read(layouts[2]),
        globalCdf: read(layouts[3]),
        localCdf: read(layouts[4]),
        globalQuantileBins: quantilesToBins(read(layouts[5])),
        localQuantileBins: quantilesToBins(read(layouts[6])),
        timing: {
          totalMs: performance.now() - started,
          readbackMs: performance.now() - started,
        },
      };
      staging.unmap();
      return result;
    } finally {
      for (const buffer of resources) {
        buffer.destroy();
      }
    }
  }
}

export async function createGpuEngine() {
  if (!globalThis.navigator?.gpu) {
    return {
      engine: null,
      reason: "当前浏览器未暴露 navigator.gpu",
    };
  }
  try {
    const adapter = await withTimeout(
      navigator.gpu.requestAdapter({
        powerPreference: "high-performance",
      }),
      INIT_TIMEOUT_MS,
      "WebGPU 适配器探测",
    );
    if (!adapter) {
      return { engine: null, reason: "未找到可用的 WebGPU 适配器" };
    }
    const device = await withTimeout(
      adapter.requestDevice(),
      INIT_TIMEOUT_MS,
      "WebGPU 设备创建",
    );
    const adapterInfo =
      adapter.info ??
      (adapter.requestAdapterInfo
        ? await adapter.requestAdapterInfo()
        : null);
    return {
      engine: new GpuEngine(device, adapterInfo),
      reason: null,
    };
  } catch (error) {
    return {
      engine: null,
      reason: `WebGPU 初始化失败：${error.message}`,
    };
  }
}
