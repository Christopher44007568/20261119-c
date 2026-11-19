import { buildReference, normalizeConfig } from "./core.js";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeImage(width, height, valueAt) {
  const values = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      values[row * width + column] = Math.fround(
        valueAt(column, row, width, height),
      );
    }
  }
  return { width, height, values };
}

export function createPreset(id, rawConfig) {
  const config = normalizeConfig(rawConfig);
  if (id === "empty") {
    return {
      id,
      label: "空图",
      eyebrow: "EDGE 01",
      description: "0 × 0，不提交直方图工作组；所有计数与分位点保持为空。",
      width: 0,
      height: 0,
      values: new Float32Array(0),
    };
  }

  if (id === "constant") {
    const image = makeImage(80, 60, () => 0.5);
    return {
      id,
      ...image,
      label: "全部同值",
      eyebrow: "EDGE 02",
      description: "4,800 个像素全部为 0.5；单个桶吸收全部有效样本。",
    };
  }

  if (id === "partial") {
    const image = makeImage(101, 67, (column, row, width, height) => {
      const x = (column + 0.5) / width;
      const y = (row + 0.5) / height;
      const radius = Math.hypot(x - 0.44, y - 0.52);
      const field =
        0.52 +
        0.34 * Math.sin(radius * 10.5) +
        0.1 * Math.cos(x * 14 - y * 10);
      return field;
    });
    return {
      id,
      ...image,
      label: "非整工作组",
      eyebrow: "EDGE 03",
      description:
        "6,767 个像素 ÷ 256；27 个工作组，末组仅 111 个有效线程。",
    };
  }

  if (id === "mixed") {
    const image = makeImage(96, 64, (column, row, width, height) => {
      const x = (column + 0.5) / width;
      const y = (row + 0.5) / height;
      return 0.5 + 0.42 * Math.sin(x * 12.4 + y * 7.2);
    });
    const specials = [
      [17, Number.NaN],
      [314, Number.NaN],
      [4099, Number.NaN],
      [1223, Number.POSITIVE_INFINITY],
      [1888, -0.71],
      [2711, 1.83],
      [5020, Number.NEGATIVE_INFINITY],
    ];
    for (const [index, value] of specials) {
      image.values[index] = value;
    }
    return {
      id,
      ...image,
      label: "NaN / 越界",
      eyebrow: "EDGE 04",
      description:
        "6,144 个像素中注入 NaN、±∞ 和范围外值，特殊计数不污染有效 CDF。",
    };
  }

  if (id === "boundaries") {
    const width = 64;
    const height = 32;
    const image = makeImage(width, height, (column, row) => {
      const points = [
        config.min,
        config.min + (config.max - config.min) * 0.25,
        (config.min + config.max) / 2,
        config.max - (config.max - config.min) * 0.25,
        config.max,
      ];
      return points[(column + row) % points.length];
    });
    return {
      id,
      ...image,
      label: "桶边界",
      eyebrow: "EDGE 05",
      description:
        "只包含范围端点与内部四分点，用于检查半开桶归属及最大值回落。",
    };
  }

  if (id === "random") {
    const random = seededRandom(0x5eedc0de);
    const image = makeImage(128, 80, () => {
      const noise = random();
      return config.min + (config.max - config.min) * noise;
    });
    return {
      id,
      ...image,
      label: "随机浮点",
      eyebrow: "RANDOM",
      description: "10,240 个确定性随机像素，覆盖整个配置范围。",
    };
  }

  throw new RangeError(`未知预设：${id}`);
}

export function createReferenceForPreset(preset, config) {
  return buildReference(preset.values, config);
}

export function createCustomImage(width, height, rawConfig) {
  const config = normalizeConfig(rawConfig);
  if (width <= 0 || height <= 0) {
    return {
      id: "custom",
      label: "自定义图像",
      eyebrow: "CUSTOM INPUT",
      description: "当前尺寸包含 0 个像素，按空图路径处理。",
      width: Math.max(0, width),
      height: Math.max(0, height),
      values: new Float32Array(0),
    };
  }
  const image = makeImage(width, height, (column, row, imageWidth, imageHeight) => {
    const x = (column + 0.5) / imageWidth;
    const y = (row + 0.5) / imageHeight;
    const radius = Math.hypot(x - 0.47, y - 0.48);
    const wave =
      0.5 +
      0.44 * Math.sin(radius * 13.5) +
      0.07 * Math.cos(x * 21 + y * 8);
    return config.min + (config.max - config.min) * wave;
  });
  return {
    id: "custom",
    ...image,
    label: "自定义图像",
    eyebrow: "CUSTOM FLOAT32",
    description: `${width.toLocaleString("en-US")} 个像素的径向浮点场；修改宽高会生成新的快照。`,
  };
}
