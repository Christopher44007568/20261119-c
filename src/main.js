import { CageDeformer, WeightCache } from './cage-model.js';
import { CageEditor } from './editor.js';
import { distance, validateCage } from './geometry.js';
import { downloadJSON, formatPoint, formatWeight, weightColor } from './visual.js';

const DEMO_CAGE = [
  { x: 345, y: 92 },
  { x: 530, y: 68 },
  { x: 688, y: 134 },
  { x: 750, y: 278 },
  { x: 684, y: 418 },
  { x: 566, y: 526 },
  { x: 410, y: 548 },
  { x: 274, y: 482 },
  { x: 212, y: 338 },
  { x: 243, y: 190 },
];

const CACHE_STORAGE_KEY = 'cage-coordinate-lab/weight-cache-v1';
const DEFAULT_RESOLUTION = 5;

const elements = {
  canvas: document.querySelector('#stageCanvas'),
  statusBadge: document.querySelector('#statusBadge'),
  statusText: document.querySelector('#statusText'),
  errorBanner: document.querySelector('#errorBanner'),
  errorMessage: document.querySelector('#errorMessage'),
  toast: document.querySelector('#toast'),
  meshChip: document.querySelector('#meshChip'),
  cacheChip: document.querySelector('#cacheChip'),
  cageStat: document.querySelector('#cageStat'),
  triangleStat: document.querySelector('#triangleStat'),
  sumStat: document.querySelector('#sumStat'),
  revisionStat: document.querySelector('#revisionStat'),
  resolutionValue: document.querySelector('#resolutionValue'),
  resolutionRange: document.querySelector('#resolutionRange'),
  selectionTag: document.querySelector('#selectionTag'),
  selectedPoint: document.querySelector('#selectedPoint'),
  weightSum: document.querySelector('#weightSum'),
  sumFill: document.querySelector('#sumFill'),
  probeNote: document.querySelector('#probeNote'),
  weightCount: document.querySelector('#weightCount'),
  weightList: document.querySelector('#weightList'),
  fingerprint: document.querySelector('#fingerprint'),
  cacheHits: document.querySelector('#cacheHits'),
  cacheMisses: document.querySelector('#cacheMisses'),
  cacheEntries: document.querySelector('#cacheEntries'),
  resetPose: document.querySelector('#resetPose'),
  addVertex: document.querySelector('#addVertex'),
  removeVertex: document.querySelector('#removeVertex'),
  resetScene: document.querySelector('#resetScene'),
  exportMesh: document.querySelector('#exportMesh'),
  exportWeights: document.querySelector('#exportWeights'),
};

const cache = new WeightCache({ limit: 12 });
let model = createModel();
let toastTimer = 0;
let lastPersistedMisses = -1;

const editor = new CageEditor({
  canvas: elements.canvas,
  model,
  onSelectionChange: () => refreshProbe(),
  onActiveChange: () => refreshWeightList(),
  onModelChange: (event) => handleModelChange(event),
});

function createModel() {
  return new CageDeformer({
    vertices: DEMO_CAGE,
    resolution: DEFAULT_RESOLUTION,
    cache,
  });
}

function showToast(message, tone = 'normal') {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.style.borderColor =
    tone === 'error' ? 'rgba(255, 111, 120, 0.38)' : 'rgba(85, 216, 255, 0.24)';
  elements.toast.style.color = tone === 'error' ? '#ffc3c7' : '#d4f4ff';
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2400);
}

function updateStatus() {
  const hasError = Boolean(model.lastError);
  elements.statusBadge.classList.toggle('is-invalid', hasError);
  elements.statusText.textContent = hasError ? '已拒绝 · 保留有效结果' : '闭笼有效';
  elements.errorBanner.hidden = !hasError;
  if (hasError) elements.errorMessage.textContent = model.lastError.message;
}

function updateStats() {
  const stats = model.stats;
  elements.cageStat.textContent = String(stats.cageVertices);
  elements.triangleStat.textContent = String(stats.triangles);
  elements.revisionStat.textContent = `r${stats.topologyRevision}`;
  const spread = stats.maxWeightSum - stats.minWeightSum;
  elements.sumStat.textContent =
    spread < 1e-9
      ? stats.maxWeightSum.toFixed(9)
      : `${stats.minWeightSum.toFixed(6)}–${stats.maxWeightSum.toFixed(6)}`;
  elements.meshChip.textContent = `${stats.fineVertices} 顶点 · ${stats.triangles} 三角形`;
  elements.cacheChip.textContent = `cache ${stats.cacheHits}H / ${stats.cacheMisses}M`;
  elements.resolutionValue.textContent = `${model.resolution}×`;
  elements.resolutionRange.value = String(model.resolution);
}

function updateCachePanel() {
  const stats = model.stats;
  elements.fingerprint.textContent = stats.fingerprint;
  elements.fingerprint.title = stats.fingerprint;
  elements.cacheHits.textContent = String(stats.cacheHits);
  elements.cacheMisses.textContent = String(stats.cacheMisses);
  elements.cacheEntries.textContent = String(stats.cacheEntries);
  if (cache.misses !== lastPersistedMisses) {
    persistCache();
    lastPersistedMisses = cache.misses;
  }
}

function persistCache() {
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache.toJSON()));
  } catch {
    // Cache export remains available when browser storage is unavailable.
  }
}

function refreshProbe() {
  if (editor.selectedMesh === null || !model.posedMeshVertices[editor.selectedMesh]) {
    editor.selectNearestToCenter(false);
  }
  const index = editor.selectedMesh;
  const referencePoint = model.mesh.vertices[index];
  const posedPoint = model.posedMeshVertices[index];
  const sum = model.weightRecord.sums[index];
  elements.selectionTag.textContent = `P#${index}`;
  elements.selectedPoint.textContent = `ref ${formatPoint(referencePoint)}\nposed ${formatPoint(posedPoint)}`;
  elements.weightSum.textContent = Number.isFinite(sum) ? sum.toFixed(9) : '—';
  elements.sumFill.style.width = `${Math.min(100, Math.max(0, sum * 100))}%`;
  elements.probeNote.textContent =
    sum === undefined
      ? '点击画布上的细网格点切换探针。'
      : `归一化后 Σw = ${sum.toFixed(12)}；权重由参考笼位置实时求解。`;
  refreshWeightList();
}

function refreshWeightList() {
  if (editor.selectedMesh === null) {
    elements.weightCount.textContent = '0';
    elements.weightList.replaceChildren(createEmptyWeightMessage());
    return;
  }

  const weights = model.weightRecord.weights[editor.selectedMesh] ?? [];
  elements.weightCount.textContent = String(weights.length);
  const fragment = document.createDocumentFragment();
  const maxAbs = Math.max(1e-9, ...weights.map((weight) => Math.abs(weight)));

  weights.forEach((weight, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'weight-row';
    row.classList.toggle('is-active', index === editor.activeCageVertex);
    row.title = `在画布上显示 C${index} 的权重热图`;

    const swatch = document.createElement('span');
    swatch.className = 'weight-swatch';
    swatch.style.background = weightColor(weight, 0.95);
    swatch.style.color = weightColor(weight, 0.55);

    const name = document.createElement('span');
    name.className = 'weight-name';
    name.textContent = `C${index}`;

    const track = document.createElement('span');
    track.className = 'weight-track';
    const fill = document.createElement('span');
    fill.className = 'weight-fill';
    fill.style.width = `${Math.min(100, (Math.abs(weight) / maxAbs) * 100)}%`;
    fill.style.background = weightColor(weight, 0.9);
    track.append(fill);

    const value = document.createElement('span');
    value.className = 'weight-value';
    value.classList.toggle('is-negative', weight < 0);
    value.textContent = formatWeight(weight);

    row.append(swatch, name, track, value);
    row.addEventListener('click', () => {
      editor.setActiveCageVertex(index);
    });
    fragment.append(row);
  });

  elements.weightList.replaceChildren(fragment);
}

function createEmptyWeightMessage() {
  const message = document.createElement('div');
  message.className = 'weight-empty';
  message.textContent = '点击细网格点以读取笼顶点权重。';
  return message;
}

function refreshAll() {
  updateStatus();
  updateStats();
  updateCachePanel();
  refreshProbe();
}

function handleModelChange({ kind, result }) {
  updateStatus();
  updateStats();
  updateCachePanel();
  refreshProbe();
  if (kind === 'drag' && result && !result.ok) {
    showToast('候选笼自交，已保留上一次有效网格。', 'error');
  }
}

function afterStructuralChange(result, successMessage, reselect = true) {
  if (result.ok && reselect) editor.selectNearestToCenter(false);
  updateStatus();
  updateStats();
  updateCachePanel();
  refreshProbe();
  if (result.ok) showToast(successMessage);
}

function longestEdgeIndex(vertices) {
  let bestIndex = 0;
  let bestLength = -1;
  vertices.forEach((point, index) => {
    const candidateLength = distance(point, vertices[(index + 1) % vertices.length]);
    if (candidateLength > bestLength) {
      bestLength = candidateLength;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function exportControlledMesh() {
  const validation = validateCage(model.posedVertices, model.referenceCage.edges);
  const payload = {
    schema: 'cage-coordinates/controlled-mesh-v1',
    exportedAt: new Date().toISOString(),
    space: '2d-world',
    cage: {
      referenceVertices: model.referenceCage.vertices,
      posedVertices: model.posedVertices,
      edges: model.referenceCage.edges,
      topologyRevision: model.topologyRevision,
      validation,
    },
    mesh: {
      vertices: model.posedMeshVertices,
      referenceVertices: model.mesh.vertices,
      triangles: model.mesh.triangles,
      vertexCount: model.mesh.vertices.length,
      triangleCount: model.mesh.triangles.length,
      subdivision: model.resolution,
    },
    weights: {
      cacheFingerprint: model.weightRecord.fingerprint,
      cacheEntries: cache.entries.size,
      sums: model.weightRecord.sums,
      minSum: model.weightRecord.minSum,
      maxSum: model.weightRecord.maxSum,
      maxAbsWeight: model.weightRecord.maxAbsWeight,
    },
  };
  downloadJSON(`controlled-mesh-${Date.now()}.json`, payload);
  showToast('受控网格已导出。');
}

function exportWeightCache() {
  const payload = cache.toJSON();
  payload.activeFingerprint = model.weightRecord.fingerprint;
  payload.activeStats = model.stats;
  payload.activeWeights = {
    weights: model.weightRecord.weights,
    sums: model.weightRecord.sums,
  };
  downloadJSON(`cage-weight-cache-${Date.now()}.json`, payload);
  showToast('权重缓存已导出。');
}

elements.resetPose.addEventListener('click', () => {
  const result = model.resetPose();
  afterStructuralChange(result, '形变已重置，权重缓存保持不变。', false);
});

elements.addVertex.addEventListener('click', () => {
  const edgeIndex = longestEdgeIndex(model.posedVertices);
  const result = model.splitEdge(edgeIndex);
  if (result.ok) editor.selectedCageVertex = null;
  afterStructuralChange(result, '已在最长控制边插入顶点，并重算细网格权重。');
});

elements.removeVertex.addEventListener('click', () => {
  if (editor.selectedCageVertex === null) {
    showToast('请先在画布上选中一个控制笼顶点。', 'error');
    return;
  }
  const result = model.removeVertex(editor.selectedCageVertex);
  if (result.ok) editor.selectedCageVertex = null;
  afterStructuralChange(result, '控制点已删除，拓扑与权重已更新。');
});

elements.resetScene.addEventListener('click', () => {
  model = createModel();
  editor.setModel(model);
  elements.resolutionRange.value = String(model.resolution);
  refreshAll();
  showToast('已恢复初始闭笼。');
});

elements.resolutionRange.addEventListener('input', () => {
  elements.resolutionValue.textContent = `${elements.resolutionRange.value}×`;
});

elements.resolutionRange.addEventListener('change', () => {
  const result = model.setResolution(Number(elements.resolutionRange.value));
  if (!result.ok) elements.resolutionRange.value = String(model.resolution);
  afterStructuralChange(result, `细网格已重建为 ${model.resolution}× 精度。`);
});

elements.exportMesh.addEventListener('click', exportControlledMesh);
elements.exportWeights.addEventListener('click', exportWeightCache);

refreshAll();
window.cageLab = {
  get model() {
    return model;
  },
  cache,
  editor,
};
