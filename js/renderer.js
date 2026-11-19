import { decodeTexel } from "./bake.js";
import {
  clamp,
  cross,
  dot,
  normalize,
  sub,
} from "./math.js";

const TARGET = [0, 0, 0.17];
const NEAR_PLANE = 0.08;
const KEY_LIGHT = normalize([-0.45, 0.72, 0.64]);
const FILL_LIGHT = normalize([0.7, 0.16, 0.48]);
const VIEW_LIGHT = normalize([0.25, 0.35, 0.9]);
const NORMAL_VIEW_LIGHT = normalize([-0.38, 0.48, 0.79]);
const GAMMA_LUT = new Uint8Array(1024);
for (let index = 0; index < GAMMA_LUT.length; index += 1) {
  GAMMA_LUT[index] = Math.round(255 * Math.pow(index / (GAMMA_LUT.length - 1), 1 / 2.2));
}

function mixColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function errorColor(degrees) {
  if (degrees < 0) return [70, 87, 96];
  const stops = [
    [42, 87, 126],
    [48, 177, 183],
    [184, 226, 95],
    [255, 175, 73],
    [255, 76, 105],
  ];
  const scaled = clamp(degrees / 14, 0, 1) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  return mixColor(stops[index], stops[index + 1], scaled - index);
}

function encodeNormalColor(normal) {
  return [
    (normal[0] * 0.5 + 0.5) * 255,
    (normal[1] * 0.5 + 0.5) * 255,
    (normal[2] * 0.5 + 0.5) * 255,
  ];
}

function shadeNormalView(normal) {
  const color = encodeNormalColor(normal);
  const light = 0.78 + Math.max(0, dot(normal, NORMAL_VIEW_LIGHT)) * 0.22;
  return [color[0] * light, color[1] * light, color[2] * light];
}

function projectPoint(point, camera, pane) {
  const relative = sub(point, camera.eye);
  const depth = dot(relative, camera.forward);
  if (depth <= NEAR_PLANE) return null;
  const x = dot(relative, camera.right) / (depth * camera.tangent * camera.aspect);
  const y = dot(relative, camera.up) / (depth * camera.tangent);
  return {
    x: pane.x + (x * 0.5 + 0.5) * pane.width,
    y: pane.y + (0.5 - y * 0.5) * pane.height,
    depth,
    inverseDepth: 1 / depth,
  };
}

function buildCamera(view, pane) {
  const cosPitch = Math.cos(view.pitch);
  const eye = [
    TARGET[0] + Math.sin(view.yaw) * cosPitch * view.distance,
    TARGET[1] + Math.sin(view.pitch) * view.distance,
    TARGET[2] + Math.cos(view.yaw) * cosPitch * view.distance,
  ];
  const forward = normalize(sub(TARGET, eye));
  const right = normalize(cross(forward, [0, 1, 0]), [1, 0, 0]);
  const up = normalize(cross(right, forward), [0, 1, 0]);
  return {
    eye,
    forward,
    right,
    up,
    aspect: pane.width / pane.height,
    tangent: Math.tan((34 * Math.PI) / 360),
  };
}

function paneLayout(width, height) {
  const gap = Math.max(8, Math.round(width * 0.009));
  const half = Math.floor((width - gap) / 2);
  return {
    high: { x: 0, y: 0, width: half, height },
    low: { x: width - half, y: 0, width: half, height },
    gap,
  };
}

function fillBackground(buffer, width, height, layout) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const inGap = x >= layout.high.width && x < layout.low.x;
      if (inGap) {
        buffer[index] = 6;
        buffer[index + 1] = 10;
        buffer[index + 2] = 12;
        buffer[index + 3] = 255;
        continue;
      }
      const pane = x < layout.high.width ? layout.high : layout.low;
      const cx = (x - pane.x) / pane.width - 0.5;
      const cy = (y - pane.y) / pane.height - 0.45;
      const radius = Math.sqrt(cx * cx + cy * cy);
      const vignette = clamp(radius * 0.95, 0, 1);
      const grid = (x % 28 === 0 || y % 28 === 0) && (x + y) % 7 === 0;
      const base = 15 - vignette * 7 + (grid ? 1.2 : 0);
      buffer[index] = base + (x > layout.high.width ? 1 : 0);
      buffer[index + 1] = base + 3;
      buffer[index + 2] = base + 5;
      buffer[index + 3] = 255;
    }
  }
}

function sampleBakedNormal(bake, u, v) {
  if (!bake || !bake.texture) return null;
  const size = bake.resolution;
  const x = Math.min(size - 1, Math.max(0, Math.floor(u * size)));
  const y = Math.min(size - 1, Math.max(0, Math.floor(v * size)));
  const index = y * size + x;
  if (!bake.raster.coverage[index]) return null;
  const offset = index * 4;
  if (bake.texture[offset + 3] === 0) return null;
  return {
    normal: decodeTexel(bake.texture, offset),
    error: bake.errorMap[index],
    index,
  };
}

function shadeLit(normal, worldPosition, viewDirection, paneRole) {
  const ndl = Math.max(0, dot(normal, KEY_LIGHT));
  const fill = Math.max(0, dot(normal, FILL_LIGHT));
  const hemi = normal[1] * 0.5 + 0.5;
  const halfVector = normalize([
    KEY_LIGHT[0] + VIEW_LIGHT[0],
    KEY_LIGHT[1] + VIEW_LIGHT[1],
    KEY_LIGHT[2] + VIEW_LIGHT[2],
  ]);
  const specular = Math.pow(Math.max(0, dot(normal, halfVector)), 34) * 0.38;
  const grazing = Math.pow(1 - clamp(Math.max(0, dot(normal, viewDirection)), 0, 1), 3);
  const base =
    paneRole === "high"
      ? [0.34, 0.36, 0.34]
      : [0.32, 0.38, 0.37];

  return [
    base[0] * (0.15 + ndl * 0.82 + fill * 0.18 + hemi * 0.12) + specular + grazing * 0.05,
    base[1] * (0.18 + ndl * 0.86 + fill * 0.2 + hemi * 0.13) + specular + grazing * 0.05,
    base[2] * (0.18 + ndl * 0.76 + fill * 0.2 + hemi * 0.14) + specular + grazing * 0.06,
  ];
}

function toneMap(color) {
  return [
    GAMMA_LUT[Math.round(clamp(color[0], 0, 1) * 1023)],
    GAMMA_LUT[Math.round(clamp(color[1], 0, 1) * 1023)],
    GAMMA_LUT[Math.round(clamp(color[2], 0, 1) * 1023)],
  ];
}

function barycentric(px, py, a, b, c) {
  const denominator =
    (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-9) return null;
  const w0 =
    ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / denominator;
  const w1 =
    ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / denominator;
  return [w0, w1, 1 - w0 - w1];
}

function drawMeshPane({
  buffer,
  depthBuffer,
  width,
  mesh,
  role,
  camera,
  pane,
  bake,
  mode,
  mirrorCorrection,
}) {
  const { positions, normals, tangents, bitangentSigns, uvs, indices } = mesh;
  const eye = camera.eye;

  for (let triangleIndex = 0; triangleIndex < indices.length; triangleIndex += 3) {
    const ia = indices[triangleIndex];
    const ib = indices[triangleIndex + 1];
    const ic = indices[triangleIndex + 2];
    const p0 = [
      positions[ia * 3],
      positions[ia * 3 + 1],
      positions[ia * 3 + 2],
    ];
    const p1 = [
      positions[ib * 3],
      positions[ib * 3 + 1],
      positions[ib * 3 + 2],
    ];
    const p2 = [
      positions[ic * 3],
      positions[ic * 3 + 1],
      positions[ic * 3 + 2],
    ];
    const faceNormal = cross(sub(p1, p0), sub(p2, p0));
    const centroid = [
      (p0[0] + p1[0] + p2[0]) / 3,
      (p0[1] + p1[1] + p2[1]) / 3,
      (p0[2] + p1[2] + p2[2]) / 3,
    ];
    const toEye = sub(eye, centroid);
    if (dot(faceNormal, toEye) <= 0) continue;

    const s0 = projectPoint(p0, camera, pane);
    const s1 = projectPoint(p1, camera, pane);
    const s2 = projectPoint(p2, camera, pane);
    if (!s0 || !s1 || !s2) continue;

    const minX = Math.max(pane.x, Math.floor(Math.min(s0.x, s1.x, s2.x)));
    const maxX = Math.min(pane.x + pane.width - 1, Math.ceil(Math.max(s0.x, s1.x, s2.x)));
    const minY = Math.max(pane.y, Math.floor(Math.min(s0.y, s1.y, s2.y)));
    const maxY = Math.min(pane.y + pane.height - 1, Math.ceil(Math.max(s0.y, s1.y, s2.y)));
    if (maxX < minX || maxY < minY) continue;

    const n0 = [
      normals[ia * 3],
      normals[ia * 3 + 1],
      normals[ia * 3 + 2],
    ];
    const n1 = [
      normals[ib * 3],
      normals[ib * 3 + 1],
      normals[ib * 3 + 2],
    ];
    const n2 = [
      normals[ic * 3],
      normals[ic * 3 + 1],
      normals[ic * 3 + 2],
    ];
    const t0 = [
      tangents[ia * 3],
      tangents[ia * 3 + 1],
      tangents[ia * 3 + 2],
    ];
    const t1 = [
      tangents[ib * 3],
      tangents[ib * 3 + 1],
      tangents[ib * 3 + 2],
    ];
    const t2 = [
      tangents[ic * 3],
      tangents[ic * 3 + 1],
      tangents[ic * 3 + 2],
    ];
    const uv0 = [uvs[ia * 2], uvs[ia * 2 + 1]];
    const uv1 = [uvs[ib * 2], uvs[ib * 2 + 1]];
    const uv2 = [uvs[ic * 2], uvs[ic * 2 + 1]];
    const sign0 = bitangentSigns[ia];
    const sign1 = bitangentSigns[ib];
    const sign2 = bitangentSigns[ic];
    const iz0 = s0.inverseDepth;
    const iz1 = s1.inverseDepth;
    const iz2 = s2.inverseDepth;

    for (let y = minY; y <= maxY; y += 1) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const weights = barycentric(px, py, s0, s1, s2);
        if (!weights || weights[0] < -1e-5 || weights[1] < -1e-5 || weights[2] < -1e-5) {
          continue;
        }

        const inverseDepth =
          weights[0] * iz0 + weights[1] * iz1 + weights[2] * iz2;
        if (inverseDepth <= 0) continue;
        const pixelIndex = y * width + x;
        if (inverseDepth <= depthBuffer[pixelIndex]) continue;

        const b0 = (weights[0] * iz0) / inverseDepth;
        const b1 = (weights[1] * iz1) / inverseDepth;
        const b2 = (weights[2] * iz2) / inverseDepth;
        const normal = normalize([
          n0[0] * b0 + n1[0] * b1 + n2[0] * b2,
          n0[1] * b0 + n1[1] * b1 + n2[1] * b2,
          n0[2] * b0 + n1[2] * b1 + n2[2] * b2,
        ]);
        const worldPosition = [
          p0[0] * b0 + p1[0] * b1 + p2[0] * b2,
          p0[1] * b0 + p1[1] * b1 + p2[1] * b2,
          p0[2] * b0 + p1[2] * b1 + p2[2] * b2,
        ];
        const viewDirection = normalize(sub(eye, worldPosition));
        let color;

        if (role === "high") {
          if (mode === "lit") {
            color = toneMap(shadeLit(normal, worldPosition, viewDirection, role));
          } else if (mode === "error") {
            const rg = encodeNormalColor(normal);
            color = [rg[0] * 0.44, rg[1] * 0.48, rg[2] * 0.56];
          } else {
            color = shadeNormalView(normal);
          }
        } else {
          const u = uv0[0] * b0 + uv1[0] * b1 + uv2[0] * b2;
          const v = uv0[1] * b0 + uv1[1] * b1 + uv2[1] * b2;
          const sampled = sampleBakedNormal(bake, u, v);
          let shadedNormal = normal;

          if (sampled) {
            const tangent = normalize([
              t0[0] * b0 + t1[0] * b1 + t2[0] * b2,
              t0[1] * b0 + t1[1] * b1 + t2[1] * b2,
              t0[2] * b0 + t1[2] * b1 + t2[2] * b2,
            ]);
            const interpolatedSign = sign0 * b0 + sign1 * b1 + sign2 * b2;
            const sign =
              !mirrorCorrection && u > 0.5
                ? 1
                : interpolatedSign < 0
                  ? -1
                  : 1;
            const bitangent = [
              cross(normal, tangent)[0] * sign,
              cross(normal, tangent)[1] * sign,
              cross(normal, tangent)[2] * sign,
            ];
            shadedNormal = normalize([
              tangent[0] * sampled.normal[0] +
                bitangent[0] * sampled.normal[1] +
                normal[0] * sampled.normal[2],
              tangent[1] * sampled.normal[0] +
                bitangent[1] * sampled.normal[1] +
                normal[1] * sampled.normal[2],
              tangent[2] * sampled.normal[0] +
                bitangent[2] * sampled.normal[1] +
                normal[2] * sampled.normal[2],
            ]);
          }

          if (mode === "lit") {
            color = toneMap(shadeLit(shadedNormal, worldPosition, viewDirection, role));
          } else if (mode === "error") {
            const error = sampled ? sampled.error : -1;
            const base = errorColor(error);
            const shape = 0.58 + Math.max(0, dot(normal, KEY_LIGHT)) * 0.42;
            color = [base[0] * shape, base[1] * shape, base[2] * shape];
          } else {
            color = shadeNormalView(shadedNormal);
          }
        }

        const offset = pixelIndex * 4;
        buffer[offset] = color[0];
        buffer[offset + 1] = color[1];
        buffer[offset + 2] = color[2];
        buffer[offset + 3] = 255;
        depthBuffer[pixelIndex] = inverseDepth;
      }
    }
  }
}

function drawSeamOverlay(ctx, model, layout, camera, color, width) {
  ctx.save();
  ctx.beginPath();
  for (const edge of model.seamEdges) {
    const mesh = edge.mesh;
    const a = [
      mesh.positions[edge.a * 3],
      mesh.positions[edge.a * 3 + 1],
      mesh.positions[edge.a * 3 + 2],
    ];
    const b = [
      mesh.positions[edge.b * 3],
      mesh.positions[edge.b * 3 + 1],
      mesh.positions[edge.b * 3 + 2],
    ];
    const pa = projectPoint(a, camera, layout.low);
    const pb = projectPoint(b, camera, layout.low);
    if (!pa || !pb) continue;
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  ctx.stroke();
  ctx.restore();
}

function drawCageOverlay(ctx, model, layout, camera, cageDistance) {
  ctx.save();
  ctx.beginPath();
  for (const mesh of model.lowMeshes) {
    const columns = mesh.columns;
    const rows = mesh.rows;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        if (column < columns - 1) {
          appendCageEdge(ctx, mesh, index, index + 1, layout.low, camera, cageDistance);
        }
        if (row < rows - 1) {
          appendCageEdge(
            ctx,
            mesh,
            index,
            index + columns,
            layout.low,
            camera,
            cageDistance,
          );
        }
      }
    }
  }
  ctx.strokeStyle = "rgba(255, 180, 92, 0.28)";
  ctx.lineWidth = 0.65;
  ctx.stroke();
  ctx.restore();
}

function appendCageEdge(ctx, mesh, aIndex, bIndex, pane, camera, distance) {
  const point = (index) => {
    return [
      mesh.positions[index * 3] + mesh.normals[index * 3] * distance,
      mesh.positions[index * 3 + 1] + mesh.normals[index * 3 + 1] * distance,
      mesh.positions[index * 3 + 2] + mesh.normals[index * 3 + 2] * distance,
    ];
  };
  const a = projectPoint(point(aIndex), camera, pane);
  const b = projectPoint(point(bIndex), camera, pane);
  if (!a || !b) return;
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
}

function drawAxisGizmo(ctx, pane, camera) {
  const originX = pane.x + 22;
  const originY = pane.y + pane.height - 25;
  const axes = [
    { vector: [1, 0, 0], color: "#ff5d76", label: "X" },
    { vector: [0, 1, 0], color: "#73e58d", label: "Y" },
    { vector: [0, 0, 1], color: "#6f9bff", label: "Z" },
  ];
  const length = 17;

  ctx.save();
  ctx.font = "7px SFMono-Regular, Consolas, monospace";
  ctx.lineWidth = 1;
  for (const axis of axes) {
    const dx = dot(axis.vector, camera.right) * length;
    const dy = -dot(axis.vector, camera.up) * length;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(originX + dx, originY + dy);
    ctx.strokeStyle = axis.color;
    ctx.globalAlpha = 0.75;
    ctx.stroke();
    ctx.fillStyle = axis.color;
    ctx.globalAlpha = 0.9;
    ctx.fillText(axis.label, originX + dx * 1.18 - 2, originY + dy * 1.18 + 2);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(130, 147, 152, 0.8)";
  ctx.fillText("WORLD", originX - 2, originY + 14);
  ctx.restore();
}

export function createSoftwareRenderer(canvas) {
  const context = canvas.getContext("2d", { alpha: false });
  let imageData = null;
  let depthBuffer = null;
  let bufferWidth = 0;
  let bufferHeight = 0;
  const view = { yaw: -0.16, pitch: 0.14, distance: 4.15 };

  function ensureSize() {
    const rectangle = canvas.getBoundingClientRect();
    const width = Math.max(640, Math.round(rectangle.width));
    const height = Math.max(360, Math.round(rectangle.height));
    if (width === bufferWidth && height === bufferHeight && imageData) return false;
    bufferWidth = width;
    bufferHeight = height;
    canvas.width = width;
    canvas.height = height;
    imageData = context.createImageData(width, height);
    depthBuffer = new Float32Array(width * height);
    context.imageSmoothingEnabled = false;
    return true;
  }

  function render(scene) {
    const sizeChanged = ensureSize();
    const width = bufferWidth;
    const height = bufferHeight;
    const layout = paneLayout(width, height);
    const startTime = performance.now();
    fillBackground(imageData.data, width, height, layout);
    depthBuffer.fill(0);
    const highCamera = buildCamera(view, layout.high);
    const lowCamera = buildCamera(view, layout.low);

    for (const mesh of scene.model.highMeshes) {
      drawMeshPane({
        buffer: imageData.data,
        depthBuffer,
        width,
        mesh,
        role: "high",
        camera: highCamera,
        pane: layout.high,
        bake: scene.bake,
        mode: scene.mode,
        mirrorCorrection: scene.mirrorCorrection,
      });
    }

    for (const mesh of scene.model.lowMeshes) {
      drawMeshPane({
        buffer: imageData.data,
        depthBuffer,
        width,
        mesh,
        role: "low",
        camera: lowCamera,
        pane: layout.low,
        bake: scene.bake,
        mode: scene.mode,
        mirrorCorrection: scene.mirrorCorrection,
      });
    }

    context.putImageData(imageData, 0, 0);
    if (scene.overlays?.cage) {
      drawCageOverlay(context, scene.model, layout, lowCamera, scene.cageDistance);
    }
    if (scene.overlays?.seams) {
      drawSeamOverlay(context, scene.model, layout, lowCamera, "rgba(255, 210, 83, 0.86)", 1.05);
    }
    drawAxisGizmo(context, layout.high, highCamera);
    drawAxisGizmo(context, layout.low, lowCamera);

    return {
      elapsedMs: performance.now() - startTime,
      sizeChanged,
      width,
      height,
    };
  }

  function orbit(deltaX, deltaY) {
    view.yaw = clamp(view.yaw + deltaX * 0.006, -0.72, 0.72);
    view.pitch = clamp(view.pitch - deltaY * 0.005, -0.48, 0.52);
  }

  function zoom(delta) {
    view.distance = clamp(view.distance + delta * 0.0016, 3.35, 5.4);
  }

  function resetView() {
    view.yaw = -0.16;
    view.pitch = 0.14;
    view.distance = 4.15;
  }

  return {
    render,
    orbit,
    zoom,
    resetView,
    getView: () => ({ ...view }),
  };
}
