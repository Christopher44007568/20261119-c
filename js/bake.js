import {
  closestPointBVH,
  cross,
  dot,
  intersectBVH,
  normalize,
} from "./math.js";
import { surfaceNormal, vertexNormal, vertexParam, vertexPosition, vertexUv } from "./geometry.js";

export const NEUTRAL_TEXEL = [128, 128, 255, 255];

export function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function encodeNormal(normal) {
  return [
    clampByte((normal[0] * 0.5 + 0.5) * 255),
    clampByte((normal[1] * 0.5 + 0.5) * 255),
    clampByte((normal[2] * 0.5 + 0.5) * 255),
  ];
}

export function decodeNormal(r, g, b) {
  return normalize([r / 127.5 - 1, g / 127.5 - 1, b / 127.5 - 1]);
}

export function decodeTexel(buffer, offset) {
  return decodeNormal(buffer[offset], buffer[offset + 1], buffer[offset + 2]);
}

function barycentric2D(px, py, ax, ay, bx, by, cx, cy) {
  const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denominator) < 1e-12) return null;
  const inverse = 1 / denominator;
  const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) * inverse;
  const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) * inverse;
  const wc = 1 - wa - wb;
  if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) return null;
  return [wa, wb, wc];
}

function interpolateVec3(data, bases, index, weights) {
  return [
    data[bases[index] * 3] * weights[0] +
      data[bases[index + 1] * 3] * weights[1] +
      data[bases[index + 2] * 3] * weights[2],
    data[bases[index] * 3 + 1] * weights[0] +
      data[bases[index + 1] * 3 + 1] * weights[1] +
      data[bases[index + 2] * 3 + 1] * weights[2],
    data[bases[index] * 3 + 2] * weights[0] +
      data[bases[index + 1] * 3 + 2] * weights[1] +
      data[bases[index + 2] * 3 + 2] * weights[2],
  ];
}

function createSurfaceRaster(model, size) {
  const count = size * size;
  const raster = {
    size,
    coverage: new Uint8Array(count),
    positions: new Float32Array(count * 3),
    normals: new Float32Array(count * 3),
    tangents: new Float32Array(count * 3),
    handedness: new Float32Array(count),
    signs: new Int8Array(count),
    params: new Float32Array(count * 2),
    island: new Uint8Array(count),
    seam: new Uint8Array(count),
    mirrored: new Uint8Array(count),
  };

  for (const [islandIndex, mesh] of model.lowMeshes.entries()) {
    const uv = mesh.uvs;

    for (let triangleIndex = 0; triangleIndex < mesh.indices.length; triangleIndex += 3) {
      const ia = mesh.indices[triangleIndex];
      const ib = mesh.indices[triangleIndex + 1];
      const ic = mesh.indices[triangleIndex + 2];
      const ua = vertexUv(mesh, ia);
      const ub = vertexUv(mesh, ib);
      const uc = vertexUv(mesh, ic);
      const minX = Math.max(0, Math.floor(Math.min(ua[0], ub[0], uc[0]) * size - 0.5));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(ua[0], ub[0], uc[0]) * size - 0.5));
      const minY = Math.max(0, Math.floor(Math.min(ua[1], ub[1], uc[1]) * size - 0.5));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(ua[1], ub[1], uc[1]) * size - 0.5));

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const weights = barycentric2D(
            (x + 0.5) / size,
            (y + 0.5) / size,
            ua[0],
            ua[1],
            ub[0],
            ub[1],
            uc[0],
            uc[1],
          );
          if (!weights) continue;

          const index = y * size + x;
          const position = interpolateVec3(mesh.positions, mesh.indices, triangleIndex, weights);
          const normal = normalize(interpolateVec3(mesh.normals, mesh.indices, triangleIndex, weights));
          const tangent = normalize(interpolateVec3(mesh.tangents, mesh.indices, triangleIndex, weights));
          const paramA = vertexParam(mesh, ia);
          const paramB = vertexParam(mesh, ib);
          const paramC = vertexParam(mesh, ic);
          const param = [
            paramA[0] * weights[0] + paramB[0] * weights[1] + paramC[0] * weights[2],
            paramA[1] * weights[0] + paramB[1] * weights[1] + paramC[1] * weights[2],
          ];
          const handedness =
            mesh.bitangentSigns[ia] * weights[0] +
            mesh.bitangentSigns[ib] * weights[1] +
            mesh.bitangentSigns[ic] * weights[2];

          raster.coverage[index] = 1;
          raster.positions[index * 3] = position[0];
          raster.positions[index * 3 + 1] = position[1];
          raster.positions[index * 3 + 2] = position[2];
          raster.normals[index * 3] = normal[0];
          raster.normals[index * 3 + 1] = normal[1];
          raster.normals[index * 3 + 2] = normal[2];
          raster.tangents[index * 3] = tangent[0];
          raster.tangents[index * 3 + 1] = tangent[1];
          raster.tangents[index * 3 + 2] = tangent[2];
          raster.handedness[index] = handedness < 0 ? -1 : 1;
          raster.signs[index] = mesh.sign;
          raster.params[index * 2] = param[0];
          raster.params[index * 2 + 1] = param[1];
          raster.island[index] = islandIndex + 1;
          raster.mirrored[index] = mesh.sign > 0 ? 1 : 0;
        }
      }
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (!raster.coverage[index]) continue;
      let boundary = false;
      for (let oy = -1; oy <= 1 && !boundary; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size || !raster.coverage[ny * size + nx]) {
            boundary = true;
            break;
          }
        }
      }
      if (boundary) raster.seam[index] = 1;
    }
  }

  return raster;
}

function interpolateHitNormal(triangle, barycentric) {
  const { u, v, w } = barycentric;
  return normalize([
    triangle.na[0] * w + triangle.nb[0] * u + triangle.nc[0] * v,
    triangle.na[1] * w + triangle.nb[1] * u + triangle.nc[1] * v,
    triangle.na[2] * w + triangle.nb[2] * u + triangle.nc[2] * v,
  ]);
}

function angleDegrees(a, b) {
  const value = Math.max(-1, Math.min(1, dot(a, b)));
  return (Math.acos(value) * 180) / Math.PI;
}

export function bakeNormalMap({
  model,
  bvh,
  resolution,
  cageDistance = 0.11,
  projection = "cage",
  repairPenetration = true,
}) {
  const startTime = performance.now();
  const size = resolution;
  const count = size * size;
  const raster = createSurfaceRaster(model, size);
  const texture = new Uint8ClampedArray(count * 4);
  const missMask = new Uint8Array(count);
  const falseMask = new Uint8Array(count);
  const penetrationMask = new Uint8Array(count);
  const repairedMask = new Uint8Array(count);
  const sampledMissMask = new Uint8Array(count);
  const errorMap = new Float32Array(count);
  const histogram = new Uint32Array(121);
  const highTriangles = model.highTriangles;
  const maxRayDistance = cageDistance + 0.19;
  const falseDistance = cageDistance + 0.06;
  let coveredCount = 0;
  let hitCount = 0;
  let missCount = 0;
  let sampledMissCount = 0;
  let falseHitCount = 0;
  let penetrationCount = 0;
  let repairedCount = 0;
  let seamCount = 0;
  let mirroredCount = 0;
  let errorSum = 0;

  for (let index = 0; index < count; index += 1) {
    if (raster.coverage[index]) {
      texture[index * 4] = NEUTRAL_TEXEL[0];
      texture[index * 4 + 1] = NEUTRAL_TEXEL[1];
      texture[index * 4 + 2] = NEUTRAL_TEXEL[2];
      texture[index * 4 + 3] = 255;
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (!raster.coverage[index]) continue;
      coveredCount += 1;
      if (raster.seam[index]) seamCount += 1;
      if (raster.mirrored[index]) mirroredCount += 1;

      const position = [
        raster.positions[index * 3],
        raster.positions[index * 3 + 1],
        raster.positions[index * 3 + 2],
      ];
      const lowNormal = normalize([
        raster.normals[index * 3],
        raster.normals[index * 3 + 1],
        raster.normals[index * 3 + 2],
      ]);
      const tangent = normalize([
        raster.tangents[index * 3],
        raster.tangents[index * 3 + 1],
        raster.tangents[index * 3 + 2],
      ]);
      const handedness = raster.handedness[index];
      const bitangent = normalize([
        cross(lowNormal, tangent)[0] * handedness,
        cross(lowNormal, tangent)[1] * handedness,
        cross(lowNormal, tangent)[2] * handedness,
      ]);
      const sign = raster.signs[index];
      const u = raster.params[index * 2];
      const v = raster.params[index * 2 + 1];
      let hit = null;
      let penetration = false;
      let repaired = false;
      let falseHit = false;

      if (projection === "cage") {
        const probe = intersectBVH(
          bvh,
          highTriangles,
          position,
          lowNormal,
          maxRayDistance,
        );
        penetration = Boolean(probe && probe.t > cageDistance + 0.002);
        if (penetration) penetrationMask[index] = 1;

        const origin = [
          position[0] + lowNormal[0] * cageDistance,
          position[1] + lowNormal[1] * cageDistance,
          position[2] + lowNormal[2] * cageDistance,
        ];
        const rayDirection = [-lowNormal[0], -lowNormal[1], -lowNormal[2]];
        hit = intersectBVH(bvh, highTriangles, origin, rayDirection, maxRayDistance);
        if (!hit) sampledMissMask[index] = 1;

        if (hit) {
          const facing = dot(hit.triangle.faceNormal, rayDirection);
          falseHit = facing > -0.15 || hit.t > falseDistance;
        }

        if (penetration && repairPenetration) {
          const nearest = closestPointBVH(bvh, highTriangles, position);
          if (nearest) {
            hit = { ...nearest, triangle: nearest.triangle };
            repaired = true;
            repairedMask[index] = 1;
            falseHit = false;
          }
        }
      } else {
        const nearest = closestPointBVH(bvh, highTriangles, position);
        if (nearest) {
          hit = { ...nearest, triangle: nearest.triangle };
          const direction = normalize([
            nearest.point[0] - position[0],
            nearest.point[1] - position[1],
            nearest.point[2] - position[2],
          ]);
          falseHit = nearest.triangle
            ? Math.abs(dot(nearest.triangle.faceNormal, direction)) < 0.05 ||
              nearest.distanceSq > (cageDistance * 2.2) ** 2
            : false;
        }
      }

      if (penetration) penetrationCount += 1;
      if (sampledMissMask[index]) sampledMissCount += 1;

      if (!hit) {
        missMask[index] = 1;
        missCount += 1;
        errorMap[index] = -1;
        continue;
      }

      hitCount += 1;
      if (repaired) repairedCount += 1;
      if (falseHit) {
        falseMask[index] = 1;
        falseHitCount += 1;
      }

      const highNormal = interpolateHitNormal(hit.triangle, hit);
      const tangentSpace = normalize([
        dot(highNormal, tangent),
        dot(highNormal, bitangent),
        dot(highNormal, lowNormal),
      ]);
      const encoded = encodeNormal(tangentSpace);
      const offset = index * 4;
      texture[offset] = encoded[0];
      texture[offset + 1] = encoded[1];
      texture[offset + 2] = encoded[2];
      texture[offset + 3] = 255;

      const decodedWorld = normalize([
        tangent[0] * tangentSpace[0] +
          bitangent[0] * tangentSpace[1] +
          lowNormal[0] * tangentSpace[2],
        tangent[1] * tangentSpace[0] +
          bitangent[1] * tangentSpace[1] +
          lowNormal[1] * tangentSpace[2],
        tangent[2] * tangentSpace[0] +
          bitangent[2] * tangentSpace[1] +
          lowNormal[2] * tangentSpace[2],
      ]);
      const target = surfaceNormal(u, v, sign, true);
      const error = angleDegrees(decodedWorld, target);
      errorMap[index] = error;
      errorSum += error;
      histogram[Math.min(120, Math.max(0, Math.round(error)))] += 1;
    }
  }

  let percentileTarget = Math.ceil(hitCount * 0.95);
  let errorP95 = 0;
  for (let bucket = 0; bucket < histogram.length; bucket += 1) {
    percentileTarget -= histogram[bucket];
    if (percentileTarget <= 0) {
      errorP95 = bucket;
      break;
    }
  }

  return {
    resolution: size,
    texture,
    raster,
    missMask,
    falseMask,
    penetrationMask,
    repairedMask,
    sampledMissMask,
    errorMap,
    metrics: {
      coveredCount,
      hitCount,
      missCount,
      sampledMissCount,
      falseHitCount,
      penetrationCount,
      repairedCount,
      seamCount,
      mirroredCount,
      hitRate: coveredCount > 0 ? hitCount / coveredCount : 0,
      meanError: hitCount > 0 ? errorSum / hitCount : 0,
      errorP95,
      elapsedMs: performance.now() - startTime,
    },
  };
}
