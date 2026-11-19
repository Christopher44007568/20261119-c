import {
  buildFineMesh,
  cycleEdges,
  deformMesh,
  lerp,
  meanValueCoordinates,
  normalizeCageOrder,
  orderedCycle,
  validateCage,
  weightSums,
} from './geometry.js';

function clonePoints(points) {
  return points.map((point) => ({ x: point.x, y: point.y }));
}

function cloneCage(cage) {
  return {
    vertices: clonePoints(cage.vertices),
    edges: cage.edges.map((edge) => [...edge]),
  };
}

function stableHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function cageFingerprint(vertices, edges, resolution) {
  const vertexText = vertices
    .map((point) => `${point.x.toFixed(6)},${point.y.toFixed(6)}`)
    .join(';');
  const edgeText = edges.map((edge) => edge.join('-')).join(';');
  return `cage-${stableHash(`${resolution}|${vertexText}|${edgeText}`)}-${vertices.length}v-${resolution}r`;
}

export class WeightCache {
  constructor({ limit = 12 } = {}) {
    this.limit = limit;
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  getOrCompute({ vertices, edges, mesh, resolution }) {
    const fingerprint = cageFingerprint(vertices, edges, resolution);
    const cached = this.entries.get(fingerprint);
    if (cached) {
      this.hits += 1;
      return { ...cached, cacheHit: true };
    }

    this.misses += 1;
    const weights = mesh.vertices.map((point) => meanValueCoordinates(point, vertices));
    const sums = weightSums(weights);
    const finiteWeights = weights.flat().filter(Number.isFinite);
    const record = {
      fingerprint,
      resolution,
      createdAt: new Date().toISOString(),
      cageVertices: clonePoints(vertices),
      edges: edges.map((edge) => [...edge]),
      meshVertexCount: mesh.vertices.length,
      weights,
      sums,
      minSum: sums.length ? Math.min(...sums) : 1,
      maxSum: sums.length ? Math.max(...sums) : 1,
      maxAbsWeight: finiteWeights.length ? Math.max(...finiteWeights.map(Math.abs)) : 0,
      cacheHit: false,
    };

    this.entries.set(fingerprint, record);
    while (this.entries.size > this.limit) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return record;
  }

  toJSON() {
    return {
      schema: 'cage-coordinates/weight-cache-v1',
      exportedAt: new Date().toISOString(),
      hits: this.hits,
      misses: this.misses,
      entries: [...this.entries.values()].map((entry) => ({ ...entry })),
    };
  }
}

export class CageDeformer {
  constructor({ vertices, resolution = 6, cache = new WeightCache() }) {
    const normalized = normalizeCageOrder(vertices);
    if (!normalized) throw new Error('无法建立闭合控制笼。');
    const validation = validateCage(normalized.vertices, normalized.edges);
    if (!validation.valid) throw new Error(validation.errors.join(' '));

    this.resolution = resolution;
    this.cache = cache;
    this.referenceCage = normalized;
    this.posedVertices = clonePoints(normalized.vertices);
    this.topologyRevision = 0;
    this.lastError = null;
    this.lastValidation = validation;
    this.mesh = buildFineMesh(this.referenceCage.vertices, this.resolution);
    this.weightRecord = null;
    this.posedMeshVertices = [];
    this._rebuildWeights();
    this._rememberValid();
  }

  _rebuildWeights() {
    this.weightRecord = this.cache.getOrCompute({
      vertices: this.referenceCage.vertices,
      edges: this.referenceCage.edges,
      mesh: this.mesh,
      resolution: this.resolution,
    });
    this.posedMeshVertices = deformMesh(this.weightRecord.weights, this.posedVertices);
  }

  _rememberValid() {
    this.lastValid = {
      referenceCage: cloneCage(this.referenceCage),
      posedVertices: clonePoints(this.posedVertices),
      posedMeshVertices: clonePoints(this.posedMeshVertices),
      meshVertexCount: this.mesh.vertices.length,
      triangleCount: this.mesh.triangles.length,
      topologyRevision: this.topologyRevision,
    };
  }

  _reject(errors, validation = this.lastValidation) {
    this.lastError = {
      message: Array.isArray(errors) ? errors.join(' ') : String(errors),
      at: new Date().toISOString(),
    };
    this.lastValidation = validation;
    return {
      ok: false,
      error: this.lastError,
      validation,
      retainedRevision: this.lastValid.topologyRevision,
    };
  }

  _accept(validation) {
    this.lastError = null;
    this.lastValidation = validation;
    this._rememberValid();
    return { ok: true, validation };
  }

  setCageVertex(index, x, y) {
    if (!Number.isInteger(index) || index < 0 || index >= this.posedVertices.length) {
      return this._reject('控制顶点索引越界。');
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return this._reject('控制顶点坐标必须为有限数值。');
    }

    const candidate = clonePoints(this.posedVertices);
    candidate[index] = { x, y };
    const validation = validateCage(candidate, this.referenceCage.edges);
    if (!validation.valid) return this._reject(validation.errors, validation);

    const candidateMesh = deformMesh(this.weightRecord.weights, candidate);
    if (candidateMesh.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      return this._reject('候选形变产生非有限网格坐标，已回退。', validation);
    }

    this.posedVertices = candidate;
    this.posedMeshVertices = candidateMesh;
    return this._accept(validation);
  }

  applyTopology(vertices, edges) {
    const rawValidation = validateCage(vertices, edges);
    if (!rawValidation.valid) return this._reject(rawValidation.errors, rawValidation);

    const cycle = rawValidation.cycle;
    const ordered = cycle.map((index) => ({ x: vertices[index].x, y: vertices[index].y }));
    const normalized = normalizeCageOrder(ordered);
    if (!normalized) return this._reject('控制笼无法规范化为闭合环。', rawValidation);
    const finalValidation = validateCage(normalized.vertices, normalized.edges);
    if (!finalValidation.valid) return this._reject(finalValidation.errors, finalValidation);

    const candidateMesh = buildFineMesh(normalized.vertices, this.resolution);
    if (candidateMesh.vertices.length === 0 || candidateMesh.triangles.length === 0) {
      return this._reject('新拓扑未能生成有效内部细网格。', finalValidation);
    }
    const candidateRecord = this.cache.getOrCompute({
      vertices: normalized.vertices,
      edges: normalized.edges,
      mesh: candidateMesh,
      resolution: this.resolution,
    });
    if (candidateRecord.sums.some((sum) => !Number.isFinite(sum) || Math.abs(sum - 1) > 1e-6)) {
      return this._reject('新拓扑的权重归一化失败，已保留上次有效结果。', finalValidation);
    }

    this.referenceCage = normalized;
    this.posedVertices = clonePoints(normalized.vertices);
    this.mesh = candidateMesh;
    this.weightRecord = candidateRecord;
    this.posedMeshVertices = clonePoints(candidateMesh.vertices);
    this.topologyRevision += 1;
    return this._accept(finalValidation);
  }

  splitEdge(edgeIndex, t = 0.5) {
    const count = this.posedVertices.length;
    if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= count) {
      return this._reject('控制边索引越界。');
    }
    const a = this.posedVertices[edgeIndex];
    const b = this.posedVertices[(edgeIndex + 1) % count];
    const midpoint = lerp(a, b, Math.min(0.9, Math.max(0.1, t)));
    const vertices = clonePoints(this.posedVertices);
    vertices.splice(edgeIndex + 1, 0, midpoint);
    return this.applyTopology(vertices, cycleEdges(vertices.length));
  }

  removeVertex(index) {
    if (this.posedVertices.length <= 3) return this._reject('闭合控制笼不能少于 3 个顶点。');
    if (!Number.isInteger(index) || index < 0 || index >= this.posedVertices.length) {
      return this._reject('控制顶点索引越界。');
    }
    const vertices = this.posedVertices.filter((_, vertexIndex) => vertexIndex !== index);
    return this.applyTopology(vertices, cycleEdges(vertices.length));
  }

  setResolution(resolution) {
    const nextResolution = Math.max(1, Math.min(16, Math.round(resolution) || 1));
    if (nextResolution === this.resolution) return { ok: true, unchanged: true };
    const validation = validateCage(this.posedVertices, this.referenceCage.edges);
    if (!validation.valid) return this._reject(validation.errors, validation);
    const candidateMesh = buildFineMesh(this.referenceCage.vertices, nextResolution);
    if (candidateMesh.vertices.length === 0) return this._reject('该精度未能生成内部细网格。');
    this.resolution = nextResolution;
    this.mesh = candidateMesh;
    this._rebuildWeights();
    return this._accept(validation);
  }

  resetPose() {
    this.posedVertices = clonePoints(this.referenceCage.vertices);
    this.posedMeshVertices = clonePoints(this.mesh.vertices);
    return this._accept(validateCage(this.posedVertices, this.referenceCage.edges));
  }

  get cycle() {
    return orderedCycle(this.referenceCage.vertices.length, this.referenceCage.edges);
  }

  get stats() {
    return {
      cageVertices: this.referenceCage.vertices.length,
      fineVertices: this.mesh.vertices.length,
      triangles: this.mesh.triangles.length,
      topologyRevision: this.topologyRevision,
      cacheEntries: this.cache.entries.size,
      cacheHits: this.cache.hits,
      cacheMisses: this.cache.misses,
      minWeightSum: this.weightRecord.minSum,
      maxWeightSum: this.weightRecord.maxSum,
      maxAbsWeight: this.weightRecord.maxAbsWeight,
      fingerprint: this.weightRecord.fingerprint,
    };
  }
}
