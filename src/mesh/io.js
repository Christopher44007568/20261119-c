import { createMesh } from './meshCore.js';
import { buildFaceCorrespondence } from './repairs.js';

function resolveIndex(token, vertexCount) {
  const raw = Number.parseInt(token.split('/')[0], 10);
  if (!Number.isFinite(raw) || raw === 0) return null;
  return raw > 0 ? raw - 1 : vertexCount + raw;
}

export function parseOBJ(text, name = '导入网格') {
  const positions = [];
  const faces = [];
  text.split(/\r?\n/).forEach((line) => {
    const clean = line.split('#')[0].trim();
    if (!clean) return;
    const parts = clean.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      positions.push(parts.slice(1, 4).map(Number));
      return;
    }
    if (parts[0] !== 'f' || parts.length < 4) return;
    const polygon = parts
      .slice(1)
      .map((token) => resolveIndex(token, positions.length))
      .filter((index) => Number.isInteger(index) && index >= 0);
    if (polygon.length < 3) return;
    for (let i = 1; i < polygon.length - 1; i += 1) {
      faces.push([polygon[0], polygon[i], polygon[i + 1]]);
    }
  });
  if (!faces.length || !positions.length) {
    throw new Error('OBJ 中没有可用的三角面');
  }
  return createMesh(name.replace(/\.obj$/i, ''), positions, faces, { imported: true });
}

export function exportOBJ(mesh, options = {}) {
  const lines = [
    '# TRIMESH topology studio',
    `# mesh: ${mesh.name}`,
    `# mode: ${options.mode || 'renderable'}`,
    `# vertices: ${mesh.positions.length}`,
    `# faces: ${mesh.faces.length}`,
    `# source-faces: ${mesh.sourceFaceCount}`,
    '',
  ];
  mesh.positions.forEach((point) => {
    lines.push(`v ${point.map((value) => value.toFixed(6)).join(' ')}`);
  });
  lines.push('');
  mesh.faces.forEach((face, outputFace) => {
    const source =
      mesh.faceMap[outputFace] === null ? 'synthetic' : mesh.faceMap[outputFace] + 1;
    lines.push(`f ${face.map((vertex) => vertex + 1).join(' ')} # source ${source}`);
  });
  return `${lines.join('\n')}\n`;
}

export function buildRepairReport({
  mesh,
  analysis,
  removed,
  history,
  activeRevision,
  sample,
}) {
  const mapping = buildFaceCorrespondence(mesh, removed);
  return {
    format: 'trimesh-topology-report',
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sample
      ? { kind: 'sample', id: sample.id, label: sample.label }
      : { kind: 'imported', label: mesh.name },
    result: {
      topology: analysis.kind,
      closed: analysis.closed,
      faces: mesh.faces.length,
      vertices: analysis.stats.vertices,
      syntheticFaces: mesh.faceMap.filter((value) => value === null).length,
      removedFaces: removed.length,
      activeRevision,
    },
    faceMapping: mapping.map((entry) => ({
      sourceFace: entry.sourceFace,
      outputFaces: entry.outputFaces,
      status: entry.status,
    })),
    operations: history.map((entry) => ({
      revision: entry.revision,
      action: entry.title,
      detail: entry.detail,
      preservedSourceFaces: entry.preserved,
      sourceFaceCount: entry.total,
      timestamp: entry.timestamp,
      active: entry.revision <= activeRevision,
    })),
    removed,
  };
}

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
