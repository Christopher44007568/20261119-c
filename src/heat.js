import { DenseCholesky, emptyMatrix, now } from "./factor.js";

function dot(ax, ay, az, bx, by, bz) {
  return ax * bx + ay * by + az * bz;
}

function cotangent(ax, ay, az, bx, by, bz) {
  return dot(ax, ay, az, bx, by, bz) / Math.max(1e-14, Math.hypot(
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx
  ));
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

function barycentric(point, a, b, c) {
  const v0 = subtract(b, a);
  const v1 = subtract(c, a);
  const v2 = subtract(point, a);
  const d00 = dot(v0[0], v0[1], v0[2], v0[0], v0[1], v0[2]);
  const d01 = dot(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2]);
  const d11 = dot(v1[0], v1[1], v1[2], v1[0], v1[1], v1[2]);
  const d20 = dot(v2[0], v2[1], v2[2], v0[0], v0[1], v0[2]);
  const d21 = dot(v2[0], v2[1], v2[2], v1[0], v1[1], v1[2]);
  const denominator = d00 * d11 - d01 * d01;
  if (Math.abs(denominator) < 1e-18) return [1 / 3, 1 / 3, 1 / 3];
  const u = (d11 * d20 - d01 * d21) / denominator;
  const v = (d00 * d21 - d01 * d20) / denominator;
  return [1 - u - v, u, v];
}

function pointFromBarycentric(mesh, face, weights) {
  const [a, b, c] = mesh.face(face);
  const pa = mesh.point(a);
  const pb = mesh.point(b);
  const pc = mesh.point(c);
  return [
    pa[0] * weights[0] + pb[0] * weights[1] + pc[0] * weights[2],
    pa[1] * weights[0] + pb[1] * weights[1] + pc[1] * weights[2],
    pa[2] * weights[0] + pb[2] * weights[1] + pc[2] * weights[2]
  ];
}

function distanceSquared(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

export class HeatMethodSolver {
  constructor(mesh) {
    this.mesh = mesh;
    this.factorStarted = now();
    this.stiffness = this._assembleStiffness();
    this.massDiagonal = this._assembleMass();
    this.timeStep = Math.max(mesh.averageEdge * mesh.averageEdge, 1e-9);
    this.heatFactor = this._buildHeatFactor();
    this.poissonFactors = this._buildPoissonFactors();
    this.factorizationMs = now() - this.factorStarted;
    this.factorBuilds = 1 + this.mesh.components.length;
    this.solveCount = 0;
    this.reuseCount = 0;
    this.lastSource = -1;
  }

  _assembleStiffness() {
    const mesh = this.mesh;
    const count = mesh.vertexCount;
    const matrix = emptyMatrix(count);
    for (let face = 0; face < mesh.faceCount; face += 1) {
      const [i, j, k] = mesh.face(face);
      const pi = mesh.point(i);
      const pj = mesh.point(j);
      const pk = mesh.point(k);
      const cotI = cotangent(
        pj[0] - pi[0], pj[1] - pi[1], pj[2] - pi[2],
        pk[0] - pi[0], pk[1] - pi[1], pk[2] - pi[2]
      );
      const cotJ = cotangent(
        pi[0] - pj[0], pi[1] - pj[1], pi[2] - pj[2],
        pk[0] - pj[0], pk[1] - pj[1], pk[2] - pj[2]
      );
      const cotK = cotangent(
        pi[0] - pk[0], pi[1] - pk[1], pi[2] - pk[2],
        pj[0] - pk[0], pj[1] - pk[1], pj[2] - pk[2]
      );
      const edges = [
        [j, k, cotI * 0.5],
        [i, k, cotJ * 0.5],
        [i, j, cotK * 0.5]
      ];
      for (const [u, v, weight] of edges) {
        matrix[u * count + u] += weight;
        matrix[v * count + v] += weight;
        matrix[u * count + v] -= weight;
        matrix[v * count + u] -= weight;
      }
    }
    return matrix;
  }

  _assembleMass() {
    const mass = new Float64Array(this.mesh.vertexCount);
    for (let face = 0; face < this.mesh.faceCount; face += 1) {
      const contribution = this.mesh.faceAreas[face] / 3;
      for (const vertex of this.mesh.face(face)) mass[vertex] += contribution;
    }
    return mass;
  }

  _buildHeatFactor() {
    const count = this.mesh.vertexCount;
    const matrix = new Float64Array(count * count);
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        matrix[row * count + column] = this.stiffness[row * count + column] * this.timeStep;
      }
      matrix[row * count + row] += this.massDiagonal[row];
    }
    return new DenseCholesky(matrix, count).factor();
  }

  _buildPoissonFactors() {
    const factors = new Map();
    const globalSize = this.mesh.vertexCount;
    for (let componentIndex = 0; componentIndex < this.mesh.components.length; componentIndex += 1) {
      const indices = this.mesh.components[componentIndex];
      const size = indices.length;
      const matrix = new Float64Array(size * size);
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          matrix[row * size + column] =
            this.stiffness[indices[row] * globalSize + indices[column]];
        }
      }
      const pin = 0;
      for (let index = 0; index < size; index += 1) {
        matrix[pin * size + index] = 0;
        matrix[index * size + pin] = 0;
      }
      matrix[pin * size + pin] = 1;
      factors.set(componentIndex, {
        indices,
        pin,
        matrix,
        factor: new DenseCholesky(matrix, size).factor()
      });
    }
    return factors;
  }

  _faceGradients(values) {
    const mesh = this.mesh;
    const gradients = new Float64Array(mesh.faceCount * 3);
    for (let face = 0; face < mesh.faceCount; face += 1) {
      const [i, j, k] = mesh.face(face);
      const pi = mesh.point(i);
      const pj = mesh.point(j);
      const pk = mesh.point(k);
      const normal = [
        mesh.faceNormals[face * 3],
        mesh.faceNormals[face * 3 + 1],
        mesh.faceNormals[face * 3 + 2]
      ];
      const doubledArea = mesh.faceAreas[face] * 2;
      const basisI = cross(normal, subtract(pk, pj));
      const basisJ = cross(normal, subtract(pi, pk));
      const basisK = cross(normal, subtract(pj, pi));
      for (let axis = 0; axis < 3; axis += 1) {
        gradients[face * 3 + axis] = (
          values[i] * basisI[axis] +
          values[j] * basisJ[axis] +
          values[k] * basisK[axis]
        ) / doubledArea;
      }
    }
    return gradients;
  }

  _normalizedDescent(values) {
    const mesh = this.mesh;
    const raw = this._faceGradients(values);
    const descent = new Float64Array(mesh.faceCount * 3);
    for (let face = 0; face < mesh.faceCount; face += 1) {
      const offset = face * 3;
      const length = Math.hypot(raw[offset], raw[offset + 1], raw[offset + 2]);
      if (length > 1e-13) {
        descent[offset] = -raw[offset] / length;
        descent[offset + 1] = -raw[offset + 1] / length;
        descent[offset + 2] = -raw[offset + 2] / length;
      }
    }
    return descent;
  }

  _poissonDivergence(descent) {
    const mesh = this.mesh;
    const divergence = new Float64Array(mesh.vertexCount);
    for (let face = 0; face < mesh.faceCount; face += 1) {
      const offset = face * 3;
      if (!descent[offset] && !descent[offset + 1] && !descent[offset + 2]) continue;
      const [i, j, k] = mesh.face(face);
      const pi = mesh.point(i);
      const pj = mesh.point(j);
      const pk = mesh.point(k);
      const normal = [
        mesh.faceNormals[offset],
        mesh.faceNormals[offset + 1],
        mesh.faceNormals[offset + 2]
      ];
      const doubledArea = mesh.faceAreas[face] * 2;
      const basis = [
        cross(normal, subtract(pk, pj)),
        cross(normal, subtract(pi, pk)),
        cross(normal, subtract(pj, pi))
      ];
      const vertices = [i, j, k];
      for (let local = 0; local < 3; local += 1) {
        divergence[vertices[local]] += mesh.faceAreas[face] * (
          dot(descent[offset], descent[offset + 1], descent[offset + 2],
            basis[local][0], basis[local][1], basis[local][2]) / doubledArea
        );
      }
    }
    return divergence;
  }

  solve(source, target = -1) {
    const started = now();
    const mesh = this.mesh;
    if (source < 0 || source >= mesh.vertexCount) throw new Error("无效源顶点");
    if (this.lastSource >= 0 && source !== this.lastSource) this.reuseCount += 1;
    this.lastSource = source;
    this.solveCount += 1;
    const componentIndex = mesh.componentOf[source];
    const component = this.poissonFactors.get(componentIndex);

    const heatStarted = now();
    const rhs = new Float64Array(mesh.vertexCount);
    rhs[source] = this.massDiagonal[source];
    const heat = this.heatFactor.solve(rhs);
    const heatMs = now() - heatStarted;

    const descent = this._normalizedDescent(heat);
    const divergence = this._poissonDivergence(descent);

    const poissonStarted = now();
    const localRhs = new Float64Array(component.indices.length);
    for (let local = 0; local < component.indices.length; local += 1) {
      localRhs[local] = divergence[component.indices[local]];
    }
    const localDistance = component.factor.solve(localRhs);
    const sourceLocal = component.indices.indexOf(source);
    const gauge = localDistance[sourceLocal];
    const distances = new Float64Array(mesh.vertexCount).fill(Infinity);
    const reachable = new Uint8Array(mesh.vertexCount);
    for (let local = 0; local < component.indices.length; local += 1) {
      const vertex = component.indices[local];
      distances[vertex] = Math.max(0, localDistance[local] - gauge);
      reachable[vertex] = 1;
    }
    const poissonMs = now() - poissonStarted;
    const path = target >= 0 && target < mesh.vertexCount
      ? this.tracePath(source, target, distances, reachable)
      : [];
    return {
      source,
      target,
      distances,
      reachable,
      path,
      componentIndex,
      reachableCount: component.indices.length,
      targetReachable: target >= 0 && reachable[target] === 1,
      timings: {
        heat: heatMs,
        poisson: poissonMs,
        total: now() - started
      }
    };
  }

  tracePath(source, target, distances, reachable) {
    const mesh = this.mesh;
    if (!reachable || reachable[target] !== 1) return [];
    const sourcePoint = mesh.point(source);
    const targetPoint = mesh.point(target);
    if (source === target) return [targetPoint];
    const finiteDistances = Float64Array.from(distances, (value) => (
      Number.isFinite(value) ? value : 0
    ));
    const gradients = this._faceGradients(finiteDistances);
    const initialFaces = mesh.facesOfVertex[target];
    let currentFace = -1;
    let bestAlignment = -Infinity;
    for (const face of initialFaces) {
      const [a, b, c] = mesh.face(face);
      const centroid = [
        (mesh.positions[a * 3] + mesh.positions[b * 3] + mesh.positions[c * 3]) / 3,
        (mesh.positions[a * 3 + 1] + mesh.positions[b * 3 + 1] + mesh.positions[c * 3 + 1]) / 3,
        (mesh.positions[a * 3 + 2] + mesh.positions[b * 3 + 2] + mesh.positions[c * 3 + 2]) / 3
      ];
      const inward = subtract(centroid, targetPoint);
      const descent = [
        -gradients[face * 3],
        -gradients[face * 3 + 1],
        -gradients[face * 3 + 2]
      ];
      const alignment = dot(
        descent[0], descent[1], descent[2],
        inward[0], inward[1], inward[2]
      );
      if (alignment > bestAlignment) {
        bestAlignment = alignment;
        currentFace = face;
      }
    }
    if (currentFace < 0) return [targetPoint, sourcePoint];

    let weights = [...barycentric(targetPoint, ...mesh.face(currentFace).map((vertex) => mesh.point(vertex)))];
    const path = [targetPoint];
    const stepLength = mesh.averageEdge * 0.42;
    const arrivalRadius = mesh.averageEdge * 0.78;

    for (let iteration = 0; iteration < 6000; iteration += 1) {
      const point = pointFromBarycentric(mesh, currentFace, weights);
      if (distanceSquared(point, sourcePoint) <= arrivalRadius * arrivalRadius) {
        path.push(sourcePoint);
        break;
      }
      const [a, b, c] = mesh.face(currentFace);
      const pa = mesh.point(a);
      const pb = mesh.point(b);
      const pc = mesh.point(c);
      const gradientOffset = currentFace * 3;
      const direction = [
        -gradients[gradientOffset],
        -gradients[gradientOffset + 1],
        -gradients[gradientOffset + 2]
      ];
      const directionLength = Math.hypot(direction[0], direction[1], direction[2]);
      if (directionLength < 1e-10) break;
      direction[0] /= directionLength;
      direction[1] /= directionLength;
      direction[2] /= directionLength;

      const toSource = subtract(sourcePoint, point);
      const sourceDistance = Math.hypot(toSource[0], toSource[1], toSource[2]);
      if (sourceDistance <= arrivalRadius * 1.45) {
        path.push(sourcePoint);
        break;
      }
      const forward = dot(
        direction[0], direction[1], direction[2],
        toSource[0], toSource[1], toSource[2]
      );
      if (forward > 0 && sourceDistance <= arrivalRadius * 2.5) {
        path.push(sourcePoint);
        break;
      }

      const edge1 = subtract(pb, pa);
      const edge2 = subtract(pc, pa);
      const d00 = dot(edge1[0], edge1[1], edge1[2], edge1[0], edge1[1], edge1[2]);
      const d01 = dot(edge1[0], edge1[1], edge1[2], edge2[0], edge2[1], edge2[2]);
      const d11 = dot(edge2[0], edge2[1], edge2[2], edge2[0], edge2[1], edge2[2]);
      const d20 = dot(direction[0], direction[1], direction[2], edge1[0], edge1[1], edge1[2]);
      const d21 = dot(direction[0], direction[1], direction[2], edge2[0], edge2[1], edge2[2]);
      const determinant = d00 * d11 - d01 * d01;
      if (Math.abs(determinant) < 1e-18) break;
      const u = (d11 * d20 - d01 * d21) / determinant;
      const v = (d00 * d21 - d01 * d20) / determinant;
      const delta = [-u - v, u, v];
      let crossing = Infinity;
      for (let local = 0; local < 3; local += 1) {
        if (delta[local] < -1e-13) crossing = Math.min(crossing, -weights[local] / delta[local]);
      }
      if (!Number.isFinite(crossing) || crossing > stepLength) {
        weights = weights.map((weight, local) => weight + delta[local] * stepLength);
        path.push(pointFromBarycentric(mesh, currentFace, weights));
        continue;
      }

      const crossedWeights = weights.map((weight, local) => weight + delta[local] * crossing);
      const crossPoint = pointFromBarycentric(mesh, currentFace, crossedWeights);
      path.push(crossPoint);
      const zero = crossedWeights.indexOf(Math.min(...crossedWeights.map(Math.abs)));
      const vertices = [a, b, c];
      const shared = [0, 1, 2].filter((local) => local !== zero).map((local) => vertices[local]);
      const nextFace = mesh.faceNeighbor(currentFace, shared);
      if (nextFace < 0) break;
      currentFace = nextFace;
      const nextVertices = mesh.face(currentFace);
      weights = barycentric(
        crossPoint,
        mesh.point(nextVertices[0]),
        mesh.point(nextVertices[1]),
        mesh.point(nextVertices[2])
      );
      if (weights.some((weight) => weight < -0.08)) break;
      weights = weights.map((weight) => Math.max(0, weight));
      const total = weights[0] + weights[1] + weights[2];
      weights = weights.map((weight) => weight / total);
      const nextDirection = [
        -gradients[currentFace * 3],
        -gradients[currentFace * 3 + 1],
        -gradients[currentFace * 3 + 2]
      ];
      const nextLength = Math.hypot(nextDirection[0], nextDirection[1], nextDirection[2]);
      if (nextLength > 1e-12) {
        const nudge = mesh.averageEdge * 2e-3;
        const nudged = [
          crossPoint[0] + nextDirection[0] / nextLength * nudge,
          crossPoint[1] + nextDirection[1] / nextLength * nudge,
          crossPoint[2] + nextDirection[2] / nextLength * nudge
        ];
        const nudgedWeights = barycentric(
          nudged,
          mesh.point(nextVertices[0]),
          mesh.point(nextVertices[1]),
          mesh.point(nextVertices[2])
        );
        if (nudgedWeights.every((weight) => weight > -0.02)) {
          const nudgedTotal = nudgedWeights[0] + nudgedWeights[1] + nudgedWeights[2];
          weights = nudgedWeights.map((weight) => Math.max(0, weight) / nudgedTotal);
        }
      }
    }

    if (distanceSquared(path[path.length - 1], sourcePoint) > arrivalRadius * arrivalRadius) {
      path.push(sourcePoint);
    }
    return this._simplifyPath(path, mesh.averageEdge * 0.045);
  }

  _simplifyPath(path, threshold) {
    if (path.length <= 2) return path;
    const simplified = [path[0]];
    const thresholdSquared = threshold * threshold;
    for (let index = 1; index < path.length - 1; index += 1) {
      if (distanceSquared(path[index], simplified[simplified.length - 1]) > thresholdSquared) {
        simplified.push(path[index]);
      }
    }
    simplified.push(path.at(-1));
    return simplified;
  }
}
