import { binInterval } from "./core.js";

const COLORS = {
  bg: "#060a0e",
  grid: "rgba(153, 192, 194, 0.10)",
  gridSoft: "rgba(153, 192, 194, 0.045)",
  text: "#6e8088",
  textLight: "#b4c4c4",
  teal: "#4de2c0",
  tealDim: "rgba(77, 226, 192, 0.35)",
  amber: "#efba61",
  rose: "#ff7698",
  orange: "#ff9d54",
};

const RAMP = [
  [0, [10, 24, 34]],
  [0.22, [24, 88, 100]],
  [0.48, [43, 166, 146]],
  [0.72, [126, 212, 177]],
  [0.88, [239, 186, 97]],
  [1, [255, 118, 152]],
];

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function rampColor(normalized) {
  const t = Math.min(1, Math.max(0, normalized));
  for (let index = 1; index < RAMP.length; index += 1) {
    const [end, endColor] = RAMP[index];
    const [start, startColor] = RAMP[index - 1];
    if (t <= end) {
      const amount = (t - start) / (end - start);
      return startColor.map((channel, channelIndex) =>
        Math.round(channel + (endColor[channelIndex] - channel) * amount),
      );
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export function drawInputPreview(canvas, snapshot, config) {
  const { context, width, height } = prepareCanvas(canvas);
  context.fillStyle = COLORS.bg;
  context.fillRect(0, 0, width, height);

  if (!snapshot.width || !snapshot.height || snapshot.values.length === 0) {
    context.strokeStyle = "rgba(153, 192, 194, 0.055)";
    context.lineWidth = 1;
    for (let x = 0; x < width; x += 24) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y < height; y += 24) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    return;
  }

  const source = document.createElement("canvas");
  source.width = snapshot.width;
  source.height = snapshot.height;
  const sourceContext = source.getContext("2d");
  const image = sourceContext.createImageData(snapshot.width, snapshot.height);
  const span = config.max - config.min;
  for (let index = 0; index < snapshot.values.length; index += 1) {
    const value = snapshot.values[index];
    let rgb;
    if (Number.isNaN(value)) {
      rgb = [255, 89, 184];
    } else if (value < config.min || value > config.max) {
      rgb = [255, 157, 84];
    } else {
      rgb = rampColor((value - config.min) / span);
    }
    const offset = index * 4;
    image.data[offset] = rgb[0];
    image.data[offset + 1] = rgb[1];
    image.data[offset + 2] = rgb[2];
    image.data[offset + 3] = 255;
  }
  sourceContext.putImageData(image, 0, 0);

  const scale = Math.min(width / snapshot.width, height / snapshot.height);
  const drawWidth = snapshot.width * scale;
  const drawHeight = snapshot.height * scale;
  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;
  context.imageSmoothingEnabled = true;
  context.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);

  const glow = context.createRadialGradient(
    width * 0.5,
    height * 0.45,
    0,
    width * 0.5,
    height * 0.45,
    Math.max(width, height) * 0.65,
  );
  glow.addColorStop(0, "rgba(77, 226, 192, 0.02)");
  glow.addColorStop(1, "rgba(4, 9, 12, 0.18)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
}

function drawGrid(context, plot, rows = 4) {
  context.save();
  context.strokeStyle = COLORS.gridSoft;
  context.lineWidth = 1;
  for (let index = 0; index <= rows; index += 1) {
    const y = plot.top + (plot.height / rows) * index;
    context.beginPath();
    context.moveTo(plot.left, y + 0.5);
    context.lineTo(plot.left + plot.width, y + 0.5);
    context.stroke();
  }
  context.restore();
}

function compactNumber(value) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  if (value >= 10_000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}k`;
  }
  return `${Math.round(value)}`;
}

export function drawHistogram(canvas, result, config) {
  const { context, width, height } = prepareCanvas(canvas);
  context.fillStyle = COLORS.bg;
  context.fillRect(0, 0, width, height);

  const bins = config.bins;
  const specialGap = 38;
  const plot = {
    left: 39,
    top: 16,
    width: Math.max(30, width - 39 - 36 - specialGap),
    height: Math.max(40, height - 16 - 31),
  };
  const totalValid = result.localCdf[bins - 1] >>> 0;
  const counts = result.mergedHistogram;
  const maxBinCount = Math.max(1, ...Array.from(counts.slice(0, bins)));
  const nanCount = counts[bins] >>> 0;
  const outCount = counts[bins + 1] >>> 0;
  const specialMax = Math.max(1, nanCount, outCount);
  drawGrid(context, plot, 4);

  context.save();
  context.font = "7px SFMono-Regular, Consolas, monospace";
  context.fillStyle = COLORS.text;
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let row = 0; row <= 4; row += 1) {
    const value = maxBinCount * (1 - row / 4);
    const y = plot.top + (plot.height / 4) * row;
    context.fillText(compactNumber(value), plot.left - 7, y);
  }
  context.textAlign = "left";
  const percentSteps = [100, 75, 50, 25, 0];
  for (let row = 0; row <= 4; row += 1) {
    const y = plot.top + (plot.height / 4) * row;
    context.fillStyle = "rgba(239, 186, 97, 0.62)";
    context.fillText(`${percentSteps[row]}%`, plot.left + plot.width + 8, y);
  }
  context.restore();

  const slot = plot.width / bins;
  const barWidth = Math.max(1, Math.min(24, slot * 0.68));
  const gradient = context.createLinearGradient(
    0,
    plot.top,
    0,
    plot.top + plot.height,
  );
  gradient.addColorStop(0, "#5ee8cb");
  gradient.addColorStop(0.55, "#239c8a");
  gradient.addColorStop(1, "rgba(22, 77, 78, 0.4)");

  for (let bin = 0; bin < bins; bin += 1) {
    const value = counts[bin] >>> 0;
    const barHeight = (value / maxBinCount) * plot.height;
    const x = plot.left + slot * bin + (slot - barWidth) / 2;
    const y = plot.top + plot.height - barHeight;
    context.fillStyle = gradient;
    context.fillRect(x, y, barWidth, Math.max(value > 0 ? 1 : 0, barHeight));
    if (bins <= 24 && width > 560 && value > 0) {
      context.save();
      context.fillStyle = "rgba(180, 196, 196, 0.62)";
      context.font = "6px SFMono-Regular, Consolas, monospace";
      context.textAlign = "center";
      context.fillText(
        compactNumber(value),
        x + barWidth / 2,
        Math.max(plot.top + 7, y - 4),
      );
      context.restore();
    }
  }

  const cdfPoints = [];
  for (let bin = 0; bin < bins; bin += 1) {
    const percent = totalValid ? (result.localCdf[bin] / totalValid) : 0;
    cdfPoints.push({
      x: plot.left + slot * (bin + 0.5),
      y: plot.top + plot.height * (1 - percent),
    });
  }
  if (cdfPoints.length > 0) {
    const area = context.createLinearGradient(
      0,
      plot.top,
      0,
      plot.top + plot.height,
    );
    area.addColorStop(0, "rgba(239, 186, 97, 0.10)");
    area.addColorStop(1, "rgba(239, 186, 97, 0)");
    context.beginPath();
    context.moveTo(cdfPoints[0].x, plot.top + plot.height);
    for (const point of cdfPoints) {
      context.lineTo(point.x, point.y);
    }
    context.lineTo(
      cdfPoints[cdfPoints.length - 1].x,
      plot.top + plot.height,
    );
    context.closePath();
    context.fillStyle = area;
    context.fill();

    context.beginPath();
    cdfPoints.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.strokeStyle = COLORS.amber;
    context.lineWidth = 1.4;
    context.shadowColor = "rgba(239, 186, 97, 0.32)";
    context.shadowBlur = 7;
    context.stroke();
    context.shadowBlur = 0;
  }

  const specialLeft = plot.left + plot.width + 35;
  const specialWidth = 13;
  drawSpecialBar(
    context,
    specialLeft,
    plot,
    nanCount,
    specialMax,
    COLORS.rose,
    "N",
  );
  drawSpecialBar(
    context,
    specialLeft + 18,
    plot,
    outCount,
    specialMax,
    COLORS.orange,
    "O",
  );

  context.save();
  context.font = "6px SFMono-Regular, Consolas, monospace";
  context.fillStyle = COLORS.text;
  context.textBaseline = "top";
  context.textAlign = "left";
  context.fillText(
    Number(config.min).toFixed(3),
    plot.left,
    plot.top + plot.height + 10,
  );
  context.textAlign = "center";
  context.fillText(
    "value domain",
    plot.left + plot.width / 2,
    plot.top + plot.height + 10,
  );
  context.textAlign = "right";
  context.fillText(
    Number(config.max).toFixed(3),
    plot.left + plot.width,
    plot.top + plot.height + 10,
  );
  context.fillStyle = COLORS.rose;
  context.textAlign = "center";
  context.fillText("N", specialLeft + specialWidth / 2, plot.top + plot.height + 10);
  context.fillStyle = COLORS.orange;
  context.fillText(
    "O",
    specialLeft + 18 + specialWidth / 2,
    plot.top + plot.height + 10,
  );
  context.restore();

  if (totalValid === 0 && nanCount === 0 && outCount === 0) {
    context.save();
    context.fillStyle = "rgba(110, 128, 136, 0.62)";
    context.font = "8px SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";
    context.fillText(
      "0 VALID SAMPLES",
      plot.left + plot.width / 2,
      plot.top + plot.height / 2,
    );
    context.restore();
  }
}

function drawSpecialBar(
  context,
  x,
  plot,
  value,
  maximum,
  color,
  label,
) {
  const barHeight = (value / maximum) * plot.height * 0.78;
  context.fillStyle = color;
  context.globalAlpha = 0.65;
  context.fillRect(
    x,
    plot.top + plot.height - barHeight,
    13,
    Math.max(value > 0 ? 1 : 0, barHeight),
  );
  context.globalAlpha = 1;
  context.save();
  context.fillStyle = color;
  context.font = "6px SFMono-Regular, Consolas, monospace";
  context.textAlign = "center";
  context.textBaseline = "bottom";
  context.fillText(
    compactNumber(value),
    x + 6.5,
    Math.max(plot.top + 7, plot.top + plot.height - barHeight - 3),
  );
  context.restore();
  return label;
}

export function drawCdf(canvas, result, config) {
  const { context, width, height } = prepareCanvas(canvas);
  context.fillStyle = COLORS.bg;
  context.fillRect(0, 0, width, height);

  const plot = {
    left: 37,
    top: 15,
    width: Math.max(30, width - 37 - 17),
    height: Math.max(40, height - 15 - 26),
  };
  const bins = config.bins;
  const cdf = result.localCdf;
  const total = cdf[bins - 1] >>> 0;
  drawGrid(context, plot, 4);

  context.save();
  context.font = "7px SFMono-Regular, Consolas, monospace";
  context.fillStyle = COLORS.text;
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let row = 0; row <= 4; row += 1) {
    const percent = 100 - row * 25;
    context.fillText(`${percent}%`, plot.left - 7, plot.top + (plot.height / 4) * row);
  }
  context.restore();

  if (total > 0) {
    const points = [
      {
        x: plot.left,
        y: plot.top + plot.height,
      },
    ];
    for (let bin = 0; bin < bins; bin += 1) {
      const x = plot.left + ((bin + 1) / bins) * plot.width;
      const y = plot.top + plot.height * (1 - cdf[bin] / total);
      points.push({ x, y });
    }

    const area = context.createLinearGradient(
      0,
      plot.top,
      0,
      plot.top + plot.height,
    );
    area.addColorStop(0, "rgba(77, 226, 192, 0.19)");
    area.addColorStop(1, "rgba(77, 226, 192, 0)");
    context.beginPath();
    context.moveTo(plot.left, plot.top + plot.height);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (index > 0) {
        context.lineTo(point.x, points[index - 1].y);
      }
      context.lineTo(point.x, point.y);
    }
    context.lineTo(plot.left + plot.width, plot.top + plot.height);
    context.closePath();
    context.fillStyle = area;
    context.fill();

    context.beginPath();
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, points[index - 1].y);
        context.lineTo(point.x, point.y);
      }
    }
    context.strokeStyle = COLORS.teal;
    context.lineWidth = 1.6;
    context.shadowColor = "rgba(77, 226, 192, 0.32)";
    context.shadowBlur = 8;
    context.stroke();
    context.shadowBlur = 0;

    const quantiles = result.localQuantileBins;
    quantiles.forEach((bin) => {
      if (bin === null || bin === undefined || bin === 0xffffffff) {
        return;
      }
      const x = plot.left + ((bin + 0.5) / bins) * plot.width;
      const y = plot.top + plot.height * (1 - cdf[bin] / total);
      context.beginPath();
      context.arc(x, y, 2.4, 0, Math.PI * 2);
      context.fillStyle = COLORS.amber;
      context.fill();
      context.beginPath();
      context.arc(x, y, 5.2, 0, Math.PI * 2);
      context.strokeStyle = "rgba(239, 186, 97, 0.2)";
      context.stroke();
    });

    context.save();
    context.fillStyle = "rgba(180, 196, 196, 0.7)";
    context.font = "6px SFMono-Regular, Consolas, monospace";
    context.textAlign = "right";
    context.fillText(
      `${compactNumber(total)} valid`,
      plot.left + plot.width,
      plot.top + 7,
    );
    context.restore();
  } else {
    context.save();
    context.fillStyle = "rgba(110, 128, 136, 0.62)";
    context.font = "8px SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";
    context.fillText(
      "EMPTY CDF · 0 VALID",
      plot.left + plot.width / 2,
      plot.top + plot.height / 2,
    );
    context.restore();
  }

  const firstBoundary = binInterval(0, config).low;
  const lastBoundary = binInterval(bins - 1, config).high;
  context.save();
  context.fillStyle = COLORS.text;
  context.font = "6px SFMono-Regular, Consolas, monospace";
  context.textBaseline = "top";
  context.textAlign = "left";
  context.fillText(
    Number(firstBoundary).toFixed(3),
    plot.left,
    plot.top + plot.height + 9,
  );
  context.textAlign = "right";
  context.fillText(
    Number(lastBoundary).toFixed(3),
    plot.left + plot.width,
    plot.top + plot.height + 9,
  );
  context.restore();
}
