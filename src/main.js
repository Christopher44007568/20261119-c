import './style.css';
import { MeshViewer } from './viewer.js';
import { SAMPLES, loadSample } from './mesh/samples.js';
import { analyzeMesh, buildDefectView, formatRanges } from './mesh/analyze.js';
import { cloneMesh } from './mesh/meshCore.js';
import {
  buildFaceCorrespondence,
  capBoundaryLoops,
  flipFaces,
  removeFaces,
  splitNonManifoldBranches,
  weldDuplicateVertices,
} from './mesh/repairs.js';
import {
  buildRepairReport,
  downloadText,
  exportOBJ,
  parseOBJ,
} from './mesh/io.js';

const ICONS = {
  undo: '<svg viewBox="0 0 20 20"><path d="M7 5 3 9l4 4"/><path d="M4 9h7a5 5 0 0 1 5 5v1"/></svg>',
  redo: '<svg viewBox="0 0 20 20"><path d="m13 5 4 4-4 4"/><path d="M16 9H9a5 5 0 0 0-5 5v1"/></svg>',
  upload: '<svg viewBox="0 0 20 20"><path d="M10 13V3m0 0L6 7m4-4 4 4"/><path d="M4 12v4h12v-4"/></svg>',
  download: '<svg viewBox="0 0 20 20"><path d="M10 3v10m0 0 4-4m-4 4L6 9"/><path d="M4 16h12"/></svg>',
  refresh: '<svg viewBox="0 0 20 20"><path d="M16 8a6 6 0 1 0-2 5"/><path d="M16 3v5h-5"/></svg>',
  close: '<svg viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15"/></svg>',
  check: '<svg viewBox="0 0 20 20"><path d="m3 10 4 4 10-10"/></svg>',
  warn: '<svg viewBox="0 0 20 20"><path d="M10 3 2 17h16L10 3Z"/><path d="M10 8v4m0 2v.2"/></svg>',
  target: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="2"/><path d="M10 1v3m0 12v3M1 10h3m12 0h3"/></svg>',
};

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="brand-copy">
          <strong>TRIMESH</strong>
          <small>TOPOLOGY STUDIO</small>
        </div>
      </div>
      <div class="top-rule"></div>
      <div class="workspace-title">
        <span>WORKSPACE / REVIEW</span>
        <strong id="top-mesh-name">两壳接触</strong>
      </div>
      <div class="live-state"><i></i><span>TOPOLOGY ANALYSIS LIVE</span></div>
      <div class="top-actions">
        <button class="tool-button" id="import-button">${ICONS.upload}<span>导入 OBJ</span></button>
        <div class="action-divider"></div>
        <button class="icon-button" id="undo-button" title="撤销 Ctrl+Z">${ICONS.undo}</button>
        <button class="icon-button" id="redo-button" title="重做 Ctrl+Shift+Z">${ICONS.redo}</button>
        <button class="export-button" id="export-button">
          <span>导出</span>${ICONS.download}
        </button>
      </div>
      <input id="file-input" type="file" accept=".obj,text/plain" hidden />
    </header>

    <main class="workspace">
      <aside class="side-panel inspect-panel">
        <div class="panel-heading">
          <div>
            <span class="kicker">01 / INSPECT</span>
            <h1>拓扑检查</h1>
          </div>
          <button class="icon-button small" id="refresh-button" title="重新分析">${ICONS.refresh}</button>
        </div>
        <div id="mesh-summary"></div>
        <div class="section-label">
          <span>缺陷分类</span>
          <span id="defect-total">05</span>
        </div>
        <div class="defect-list" id="defect-list"></div>
        <div class="case-note" id="case-note"></div>
      </aside>

      <section class="viewport" id="viewport">
        <div class="canvas-host" id="viewport-canvas"></div>
        <div class="view-frame" aria-hidden="true">
          <i></i><i></i><i></i><i></i>
        </div>
        <div class="viewport-topline">
          <div class="view-meta">
            <span>PERSPECTIVE</span><span>METRIC / SCENE</span>
          </div>
          <div class="sample-switch" id="sample-switch">
            ${SAMPLES.map(
              (sample) => `
                <button data-sample="${sample.id}">
                  <span>${sample.eyebrow.split(' / ')[0]}</span>
                  <strong>${sample.label}</strong>
                </button>`,
            ).join('')}
          </div>
          <div class="view-meta right"><span id="view-face-count">08 FACES</span><span>WEBGL</span></div>
        </div>
        <div class="camera-cluster">
          <button data-view="iso" class="active">ISO</button>
          <button data-view="top">TOP</button>
          <button data-view="front">FRONT</button>
          <button data-fit="true">${ICONS.target}<span>FIT</span></button>
        </div>
        <div class="viewport-legend" id="viewport-legend"></div>
        <div class="axis-widget" aria-hidden="true">
          <span class="axis-y">Y</span>
          <span class="axis-x">X</span>
          <span class="axis-z">Z</span>
          <i></i>
        </div>
        <div class="viewport-footer">
          <div class="selection-readout" id="selection-readout"></div>
          <div class="display-toggles">
            <button data-toggle="showDefects" class="active">缺陷着色</button>
            <button data-toggle="showEdges" class="active">边线</button>
            <button data-toggle="showNormals">法线</button>
          </div>
        </div>
        <div class="drop-hint" id="drop-hint">释放以导入 OBJ</div>
      </section>

      <aside class="side-panel detail-panel">
        <div class="panel-heading">
          <div>
            <span class="kicker">02 / DIAGNOSE</span>
            <h1>修复建议</h1>
          </div>
          <span class="detail-code" id="detail-code">NM</span>
        </div>
        <div class="detail-scroll" id="detail-panel"></div>
        <div class="history-heading">
          <span>撤销记录</span>
          <span id="history-count">0 STEPS</span>
        </div>
        <div class="history-list" id="history-list"></div>
      </aside>
    </main>

    <footer class="statusbar">
      <div class="status-left"><i></i><span id="footer-status">READY / 分析完成</span></div>
      <div class="status-center" id="footer-map">INPUT → OUTPUT / 8 OF 8 PRESERVED</div>
      <div class="status-right">OBJ 1.0 <span>/</span> LOCAL SESSION</div>
    </footer>

    <div class="export-menu" id="export-menu" hidden>
      <div class="export-head">
        <div><span class="kicker">EXPORT</span><strong>导出当前结果</strong></div>
        <button class="icon-button small" data-close-export>${ICONS.close}</button>
      </div>
      <div class="export-state" id="export-state"></div>
      <button class="export-option" id="export-closed">
        <span class="export-icon">${ICONS.check}</span>
        <span><strong>OBJ · 封闭网格</strong><small>仅在水密且无非流形边时可用</small></span>
        <b>01</b>
      </button>
      <button class="export-option" id="export-renderable">
        <span class="export-icon">${ICONS.download}</span>
        <span><strong>OBJ · 可渲染网格</strong><small>保留全部现有面，不宣称封闭</small></span>
        <b>02</b>
      </button>
      <button class="export-option" id="export-report">
        <span class="export-icon">${ICONS.target}</span>
        <span><strong>修复与映射报告</strong><small>JSON / 面映射 / 撤销记录</small></span>
        <b>03</b>
      </button>
    </div>
    <div class="toast-stack" id="toast-stack"></div>
  </div>
`;

const viewer = new MeshViewer(document.querySelector('#viewport-canvas'));

const ui = {
  meshSummary: document.querySelector('#mesh-summary'),
  defectList: document.querySelector('#defect-list'),
  detailPanel: document.querySelector('#detail-panel'),
  historyList: document.querySelector('#history-list'),
  historyCount: document.querySelector('#history-count'),
  detailCode: document.querySelector('#detail-code'),
  caseNote: document.querySelector('#case-note'),
  topMeshName: document.querySelector('#top-mesh-name'),
  footerStatus: document.querySelector('#footer-status'),
  footerMap: document.querySelector('#footer-map'),
  selectionReadout: document.querySelector('#selection-readout'),
  legend: document.querySelector('#viewport-legend'),
  faceCount: document.querySelector('#view-face-count'),
  undoButton: document.querySelector('#undo-button'),
  redoButton: document.querySelector('#redo-button'),
  exportMenu: document.querySelector('#export-menu'),
  exportState: document.querySelector('#export-state'),
  toastStack: document.querySelector('#toast-stack'),
  dropHint: document.querySelector('#drop-hint'),
};

const state = {
  sampleId: 'shells',
  sample: SAMPLES[0],
  mesh: null,
  analysis: null,
  defects: [],
  selection: { key: null, groupId: null },
  revisions: [],
  activeRevision: 0,
  history: [],
  display: { showDefects: true, showEdges: true, showNormals: false },
  lastOperation: null,
};

const META = {
  nonmanifold: {
    code: 'NM',
    eyebrow: 'EDGE INCIDENCE > 2',
    title: '非流形边',
    lead: '一条边被超过两个面共享，壳体的“内外”无法唯一确定。',
    body: '工具不会把任一侧当成多余分支删除。拆分操作会复制接触边顶点并重新连接面，保留所有输入面及其对应关系。',
    safe: false,
    fixLabel: '拆分当前分支',
    keepLabel: '保留分支',
  },
  duplicates: {
    code: 'DV',
    eyebrow: 'COINCIDENT VERTICES',
    title: '重复顶点',
    lead: '多个顶点位置重合，但拓扑上仍彼此分离。',
    body: '焊接会合并重合点并压缩未使用顶点，不改变面序。若焊接会让同一个面出现重合角点，该组会被跳过。',
    safe: true,
    fixLabel: '焊接当前组',
    keepLabel: '暂不处理',
  },
  isolated: {
    code: 'IF',
    eyebrow: 'SINGLETON FACE',
    title: '孤立面',
    lead: '一个面不与任何其他面共享边，无法构成可解释的曲面区域。',
    body: '孤立面可能是扫描噪点，也可能是用户想保留的独立标记。删除只会在你明确点击后发生，并写入撤销记录。',
    safe: false,
    fixLabel: '删除当前孤立面',
    keepLabel: '保留孤立面',
  },
  normals: {
    code: 'NR',
    eyebrow: 'WINDING ORDER',
    title: '反向 / 不一致法线',
    lead: '相邻面在共享边上的绕序不一致，或闭合壳整体朝内。',
    body: '通过流形边传播绕序；闭合分量用有向体积判定外向，开放分量只能统一朝向，无法仅凭拓扑判断正反。',
    safe: true,
    fixLabel: '翻转当前组',
    keepLabel: '保持原绕序',
  },
  boundary: {
    code: 'BD',
    eyebrow: 'BOUNDARY LOOP',
    title: '开放边界',
    lead: '边界边只入射一个面，网格存在可见开口。',
    body: '封口会沿边界环新增三角面，并以 synthetic 标记；原始输入面的映射保持不变。是否封口由你决定。',
    safe: false,
    fixLabel: '封口当前边界',
    keepLabel: '保留开口',
  },
};

function currentRevision() {
  return state.revisions[state.activeRevision];
}

function activeDefect() {
  return state.defects.find((defect) => defect.key === state.selection.key) || null;
}

function activeGroup() {
  const defect = activeDefect();
  if (!defect) return null;
  return (
    defect.groups.find((group) => group.id === state.selection.groupId) ||
    defect.groups[0] ||
    null
  );
}

function normalizeSelection() {
  const available = state.defects.filter((defect) => defect.count > 0);
  const selected = available.find((defect) => defect.key === state.selection.key);
  if (selected) {
    const groupExists = selected.groups.some(
      (group) => group.id === state.selection.groupId,
    );
    if (!groupExists) state.selection.groupId = selected.groups[0]?.id || null;
    return;
  }
  state.selection.key = available[0]?.key || null;
  state.selection.groupId = available[0]?.groups[0]?.id || null;
}

function getSelectionView() {
  const defect = activeDefect();
  if (!defect || defect.count === 0) return null;
  const group = activeGroup();
  const groups = group ? [group] : defect.groups;
  const edges = [];
  if (defect.key === 'nonmanifold') {
    groups.forEach((item) => edges.push(...(item.edges || [])));
  }
  if (defect.key === 'boundary') {
    groups.forEach((item) => {
      item.loop?.edgeIndices.forEach((edgeIndex) => {
        edges.push(state.analysis.topology.boundaryEdges[edgeIndex]);
      });
    });
  }
  return {
    key: defect.key,
    groupId: group?.id || null,
    faces: [...new Set(groups.flatMap((item) => item.faces || []))],
    vertices: [...new Set(groups.flatMap((item) => item.vertices || []))],
    edges,
  };
}

function healthScore() {
  const { stats } = state.analysis;
  const penalty =
    stats.nonManifoldEdges * 16 +
    stats.duplicateGroups * 7 +
    stats.isolatedFaces * 7 +
    stats.normalGroups * 9 +
    stats.boundaryLoops * 4;
  return Math.max(0, Math.min(100, 100 - penalty));
}

function kindLabel() {
  return {
    CLOSED_SOLID: '封闭实体',
    OPEN_SURFACE: '开放曲面',
    NON_MANIFOLD: '非流形结构',
  }[state.analysis.kind];
}

function renderSummary() {
  const { stats, kind } = state.analysis;
  const score = healthScore();
  const statusClass =
    kind === 'CLOSED_SOLID' ? 'closed' : kind === 'NON_MANIFOLD' ? 'danger' : 'open';
  ui.meshSummary.innerHTML = `
    <div class="mesh-status ${statusClass}">
      <div class="status-copy">
        <span class="micro-label">TOPOLOGY STATE</span>
        <strong>${kindLabel()}</strong>
        <small>${kind.replaceAll('_', ' ')}</small>
      </div>
      <div class="health-ring" style="--score:${score}">
        <span>${score}</span><small>HEALTH</small>
      </div>
    </div>
    <div class="metric-grid">
      <div><span>VERTICES</span><strong>${String(stats.vertices).padStart(2, '0')}</strong></div>
      <div><span>FACES</span><strong>${String(stats.faces).padStart(2, '0')}</strong></div>
      <div><span>EDGES</span><strong>${String(stats.edges).padStart(2, '0')}</strong></div>
      <div><span>SHELLS</span><strong>${String(stats.components).padStart(2, '0')}</strong></div>
    </div>
    <div class="summary-strip">
      <span>边界 <b>${stats.boundaryEdges}</b></span>
      <span>非流形 <b>${stats.nonManifoldEdges}</b></span>
      <span>χ <b>${stats.euler}</b></span>
    </div>
  `;
}

function defectRangeData(defect) {
  const vertices = defect.groups.flatMap((group) => group.vertices || []);
  const faces = defect.groups.flatMap((group) => group.faces || []);
  return {
    vertices: formatRanges(vertices, 'V'),
    faces: formatRanges(faces, 'F'),
  };
}

function renderDefectList() {
  ui.defectList.innerHTML = state.defects
    .map((defect) => {
      const active = defect.key === state.selection.key;
      const meta = META[defect.key];
      const ranges = defectRangeData(defect);
      const hasIssues = defect.count > 0;
      return `
        <button class="defect-card ${active ? 'active' : ''} ${
          hasIssues ? '' : 'clear'
        }" data-defect="${defect.key}">
          <span class="defect-accent"></span>
          <div class="defect-card-head">
            <span class="defect-code">${defect.code}</span>
            <strong>${defect.title}</strong>
            <span class="defect-count">${String(defect.count).padStart(2, '0')}</span>
          </div>
          <div class="defect-detail">${hasIssues ? defect.detail : '无检测项'}</div>
          ${
            hasIssues
              ? `<div class="defect-ranges">
                  <span>${ranges.vertices}</span>
                  <span>${ranges.faces}</span>
                </div>`
              : ''
          }
          <div class="defect-foot">
            <span class="severity ${meta.safe ? 'repairable' : 'decision'}">${
              meta.safe ? '可修复' : '需决策'
            }</span>
            <span>${hasIssues ? `${defect.groups.length} 组` : 'PASS'}</span>
          </div>
        </button>
      `;
    })
    .join('');
  document.querySelector('#defect-total').textContent = String(
    state.defects.filter((defect) => defect.count > 0).length,
  ).padStart(2, '0');
}

function renderCaseNote() {
  if (state.sample) {
    ui.caseNote.innerHTML = `
      <span class="micro-label">${state.sample.eyebrow}</span>
      <p>${state.sample.description}</p>
      <small>示例说明 · 分析结果不是删除授权</small>
    `;
  } else {
    ui.caseNote.innerHTML = `
      <span class="micro-label">IMPORTED MESH</span>
      <p>当前网格来自本地 OBJ。所有修复仍会在浏览器内完成。</p>
      <small>LOCAL / ${state.mesh.sourceFaceCount} SOURCE FACES</small>
    `;
  }
}

function renderLegend() {
  const visible = state.defects.filter((defect) => defect.count > 0);
  ui.legend.innerHTML = visible.length
    ? visible
        .map(
          (defect) => `
          <span class="legend-item ${state.selection.key === defect.key ? 'active' : ''}" data-key="${
            defect.key
          }">
            <i></i>${defect.code} ${defect.title}
          </span>`,
        )
        .join('')
    : '<span class="legend-ok">NO TOPOLOGY DEFECTS</span>';
}

function renderViewportStatus() {
  const defect = activeDefect();
  const group = activeGroup();
  if (!defect || !group) {
    ui.selectionReadout.innerHTML = `
      <span class="readout-label">CURRENT SELECTION</span>
      <strong>ALL CLEAR</strong><span>无缺陷高亮</span>`;
  } else {
    const ranges = defectRangeData({ ...defect, groups: [group] });
    ui.selectionReadout.innerHTML = `
      <span class="readout-label">CURRENT SELECTION</span>
      <strong>${defect.code} / ${group.id.split('-')[1].padStart(2, '0')}</strong>
      <span>${ranges.vertices} · ${ranges.faces}</span>`;
  }
  ui.faceCount.textContent = `${String(state.mesh.faces.length).padStart(2, '0')} FACES`;
}

function renderHistory() {
  const rows = [
    {
      revision: 0,
      title: '原始输入',
      detail: `${state.revisions[0]?.mesh.sourceFaceCount || 0} 个源面进入分析`,
      preserved: state.revisions[0]?.mesh.sourceFaceCount || 0,
      total: state.revisions[0]?.mesh.sourceFaceCount || 0,
      timestamp: '--:--:--',
    },
    ...state.history,
  ];
  ui.historyList.innerHTML = rows
    .map((entry) => {
      const active = entry.revision === state.activeRevision;
      const undone = entry.revision > state.activeRevision;
      return `
        <button class="history-row ${active ? 'active' : ''} ${
          undone ? 'undone' : ''
        }" data-revision="${entry.revision}">
          <span class="history-index">${String(entry.revision).padStart(2, '0')}</span>
          <span class="history-copy">
            <strong>${entry.title}</strong>
            <small>${entry.detail}</small>
          </span>
          <span class="history-meta">
            <b>${entry.preserved}/${entry.total}</b>
            <small>${active ? 'CURRENT' : undone ? 'UNDONE' : entry.timestamp}</small>
          </span>
        </button>
      `;
    })
    .join('');
  ui.historyCount.textContent = `${String(state.history.length).padStart(2, '0')} STEPS`;
  ui.undoButton.disabled = state.activeRevision === 0;
  ui.redoButton.disabled = state.activeRevision >= state.revisions.length - 1;
}

function renderFooter() {
  const mapping = buildFaceCorrespondence(state.mesh, currentRevision().removed);
  const preserved = mapping.filter((entry) => entry.status === 'preserved').length;
  const synthetic = state.mesh.faceMap.filter((value) => value === null).length;
  ui.footerMap.textContent = `INPUT → OUTPUT / ${preserved} OF ${
    state.mesh.sourceFaceCount
  } PRESERVED${synthetic ? ` / ${synthetic} SYNTHETIC` : ''}`;
  ui.footerStatus.textContent =
    state.activeRevision === 0
      ? 'READY / 分析完成'
      : `READY / 已应用 ${state.activeRevision} 步修复`;
}

function groupDescription(defectKey, group) {
  if (defectKey === 'nonmanifold') {
    return `${group.edges.length} 条边 · ${group.faces.length} 个面围绕接触边`;
  }
  if (defectKey === 'duplicates') {
    return `${group.vertices.length} 个顶点共用同一坐标`;
  }
  if (defectKey === 'isolated') {
    return `${formatRanges(group.faces, 'F')} 独立三角面`;
  }
  if (defectKey === 'normals') {
    return group.mode === 'inward'
      ? '闭合分量整体朝内'
      : '共享边两侧绕序不一致';
  }
  if (defectKey === 'boundary') {
    return `${group.vertices.length} 个边界顶点 · ${group.loop.edgeIndices.length} 条边`;
  }
  return '';
}

function suggestionItems(defectKey) {
  return {
    nonmanifold: [
      '复制接触边顶点，使壳体拓扑分离但保留几何接触',
      '所有输入面保留，面数不变；面板同步记录复制顶点数',
      '直接保留分叉时，导出菜单只开放“可渲染网格”',
    ],
    duplicates: [
      '合并位置相同且不构成退化面的顶点',
      '压缩索引后重新分析，面顺序与源面映射保持不变',
      '可能产生退化面的组会被跳过，不会隐式删面',
    ],
    isolated: [
      '删除会从当前网格移除选中的单面连通块',
      '被删源面写入撤销记录与映射报告，状态标记 isolated',
      '保留孤立面时，工具不会将其计入封闭结果',
    ],
    normals: [
      '沿流形共享边传播绕序，校正不一致的面',
      '闭合壳体通过有向体积判定并整体转为外向',
      '开放曲面的“正反”不可由拓扑唯一判定，只保证一致',
    ],
    boundary: [
      '沿边界环添加质心并生成扇形三角面',
      '新增面标记 synthetic，不占用原始输入面编号',
      '封口前若仍有反向面，建议先统一绕序再封闭',
    ],
  }[defectKey];
}

function renderGroupTabs(defect, group) {
  if (defect.groups.length <= 1) return '';
  return `
    <div class="group-tabs">
      ${defect.groups
        .map(
          (item, index) => `
          <button class="${item.id === group?.id ? 'active' : ''}" data-group="${item.id}">
            G${String(index + 1).padStart(2, '0')}
            <small>${(item.faces || []).length}F</small>
          </button>`,
        )
        .join('')}
    </div>
  `;
}

function renderAllClear() {
  const closed = state.analysis.closed;
  ui.detailCode.textContent = closed ? 'OK' : '—';
  ui.detailPanel.innerHTML = `
    <div class="all-clear">
      <div class="clear-mark">${ICONS.check}</div>
      <span class="micro-label">TOPOLOGY PASS</span>
      <h2>${closed ? '网格已封闭' : '可渲染网格'}</h2>
      <p>${
        closed
          ? '边界环与非流形边均已清零。当前结果可以按封闭网格导出。'
          : '未发现流形拓扑缺陷，但当前结果不满足封闭条件。'
      }</p>
      <div class="clear-stats">
        <span><b>${state.mesh.faces.length}</b> FACES</span>
        <span><b>${state.analysis.stats.vertices}</b> VERTICES</span>
        <span><b>${state.analysis.stats.components}</b> SHELLS</span>
      </div>
      <button class="primary-action" data-action="export">${ICONS.download} 打开导出</button>
    </div>
    <div class="detail-note">
      <span>检查范围</span>
      <p>边界边入射数、非流形边、重合顶点、单面连通块、流形绕序传播与有向体积。</p>
    </div>
  `;
}

function renderDetail() {
  const defect = activeDefect();
  if (!defect || defect.count === 0) {
    renderAllClear();
    return;
  }
  const group = activeGroup();
  const meta = META[defect.key];
  const ranges = defectRangeData({ ...defect, groups: group ? [group] : defect.groups });
  const mapping = buildFaceCorrespondence(state.mesh, currentRevision().removed);
  const preserved = mapping.filter((entry) => entry.status === 'preserved').length;
  const percent = Math.round((preserved / Math.max(1, state.mesh.sourceFaceCount)) * 100);
  ui.detailCode.textContent = defect.code;
  ui.detailPanel.innerHTML = `
    <div class="detail-hero">
      <div class="detail-hero-top">
        <span class="micro-label">${meta.eyebrow}</span>
        <span class="severity ${meta.safe ? 'repairable' : 'decision'}">${
          meta.safe ? '安全修复' : '需要用户决策'
        }</span>
      </div>
      <h2>${meta.title}</h2>
      <p class="detail-lead">${meta.lead}</p>
      <p class="detail-body">${meta.body}</p>
    </div>
    ${renderGroupTabs(defect, group)}
    <div class="range-panel">
      <div class="range-head">
        <span>当前组范围</span>
        <span>${groupDescription(defect.key, group)}</span>
      </div>
      <div class="range-grid">
        <div>
          <span class="micro-label">VERTEX RANGE</span>
          <strong>${ranges.vertices}</strong>
        </div>
        <div>
          <span class="micro-label">FACE RANGE</span>
          <strong>${ranges.faces}</strong>
        </div>
      </div>
    </div>
    <div class="mapping-preview">
      <div><span>输入面映射</span><b>${preserved} / ${state.mesh.sourceFaceCount}</b></div>
      <div class="mapping-bar"><i style="width:${percent}%"></i></div>
      <small>每个操作前后保留 sourceFace → outputFace 对应</small>
    </div>
    <div class="suggestion-box">
      <div class="suggestion-head">
        <span class="micro-label">REPAIR OPTION</span>
        <strong>${groupDescription(defect.key, group)}</strong>
      </div>
      <ul>${suggestionItems(defect.key)
        .map((item) => `<li>${item}</li>`)
        .join('')}</ul>
      <div class="action-stack">
        <button class="primary-action" data-action="fix">${meta.fixLabel}<span>→</span></button>
        ${
          defect.groups.length > 1
            ? `<button class="secondary-action" data-action="fixAll">应用到全部 ${defect.groups.length} 组</button>`
            : ''
        }
        <button class="text-action" data-action="keep">${meta.keepLabel}</button>
      </div>
    </div>
    <div class="decision-note ${meta.safe ? 'safe' : ''}">
      <span>${meta.safe ? ICONS.check : ICONS.warn}</span>
      <p>${
        meta.safe
          ? '该操作可逆，面映射会随撤销记录一同保留。'
          : '该操作需要明确选择；工具不会自动删除或隐藏缺陷。'
      }</p>
    </div>
  `;
}

function renderAll({ fit = false } = {}) {
  renderSummary();
  renderDefectList();
  renderDetail();
  renderCaseNote();
  renderLegend();
  renderViewportStatus();
  renderHistory();
  renderFooter();
  ui.topMeshName.textContent = state.mesh.name;
  document.querySelectorAll('[data-sample]').forEach((button) => {
    button.classList.toggle('active', button.dataset.sample === state.sampleId);
  });
  viewer.setData(state.mesh, state.analysis, getSelectionView());
  viewer.setDisplayOptions(state.display);
  if (fit) viewer.fit();
}

function refresh({ fit = false } = {}) {
  state.analysis = analyzeMesh(state.mesh);
  state.defects = buildDefectView(state.analysis);
  normalizeSelection();
  renderAll({ fit });
}

function startScene(mesh, sample, sampleId) {
  state.sample = sample;
  state.sampleId = sampleId;
  state.mesh = cloneMesh(mesh);
  state.revisions = [{ mesh: cloneMesh(mesh), removed: [] }];
  state.activeRevision = 0;
  state.history = [];
  state.selection = { key: null, groupId: null };
  refresh({ fit: true });
}

function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ],
  );
}

function toast(title, message, type = 'info') {
  while (ui.toastStack.children.length >= 3) {
    ui.toastStack.firstElementChild?.remove();
  }
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.innerHTML = `
    <span class="toast-mark">${type === 'success' ? ICONS.check : ICONS.warn}</span>
    <span><strong>${escapeHTML(title)}</strong><small>${escapeHTML(message)}</small></span>
  `;
  ui.toastStack.appendChild(element);
  requestAnimationFrame(() => element.classList.add('visible'));
  setTimeout(() => {
    element.classList.remove('visible');
    setTimeout(() => element.remove(), 280);
  }, 3600);
}

function commit(mesh, removed, title, detail) {
  if (state.activeRevision < state.revisions.length - 1) {
    state.revisions = state.revisions.slice(0, state.activeRevision + 1);
    state.history = state.history.filter(
      (entry) => entry.revision <= state.activeRevision,
    );
  }
  const revision = state.activeRevision + 1;
  const mapping = buildFaceCorrespondence(mesh, removed);
  const preserved = mapping.filter((entry) => entry.status === 'preserved').length;
  const entry = {
    revision,
    title,
    detail,
    preserved,
    total: mesh.sourceFaceCount,
    timestamp: new Date().toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
  state.revisions.push({
    mesh: cloneMesh(mesh),
    removed: removed.map((item) => ({ ...item })),
  });
  state.mesh = mesh;
  state.activeRevision = revision;
  state.history.push(entry);
  state.lastOperation = entry;
  refresh({ fit: false });
  toast(title, detail, 'success');
}

function selectedGroupIndex(defect, group) {
  return Math.max(
    0,
    defect.groups.findIndex((item) => item.id === group.id),
  );
}

function executeFix(mode = 'fix') {
  const defect = activeDefect();
  const group = activeGroup();
  if (!defect || !group) return;
  const all = mode === 'fixAll';
  const removed = currentRevision().removed;
  let result;
  let title;
  let detail;

  if (defect.key === 'nonmanifold') {
    result = splitNonManifoldBranches(
      state.mesh,
      state.analysis,
      all ? null : [selectedGroupIndex(defect, group)],
    );
    title = '拆分非流形分支';
    detail = `${result.copiedVertices} 个顶点复制 · ${result.splitEdges} 条接触边 · 面未删除`;
    if (result.changed === 0) {
      toast('无法拆分', '该分支在移除非流形边后无法形成两个独立连通块', 'warning');
      return;
    }
  }

  if (defect.key === 'duplicates') {
    const selected = all
      ? null
      : [selectedGroupIndex(defect, group)];
    result = weldDuplicateVertices(state.mesh, state.analysis, selected);
    title = '焊接重复顶点';
    detail = `${result.changed} 组合并${
      result.skipped ? ` · ${result.skipped} 组因退化风险跳过` : ''
    }`;
    if (result.changed === 0) {
      toast('未执行焊接', '所有候选组都会造成退化面', 'warning');
      return;
    }
  }

  if (defect.key === 'isolated') {
    const faces = all
      ? [...state.analysis.isolatedFaces]
      : [...group.faces];
    result = removeFaces(state.mesh, faces, removed);
    title = '删除孤立面';
    detail = `${result.changed} 个面已显式删除 · 源面映射记为 isolated`;
  }

  if (defect.key === 'normals') {
    const faces = all
      ? state.analysis.normalGroups.flatMap((item) => item.faces)
      : [...group.faces];
    result = flipFaces(state.mesh, faces);
    title = '统一面绕序';
    detail = `翻转 ${result.changed} 个面 · 顶点与面索引不变`;
  }

  if (defect.key === 'boundary') {
    const loopIndex = Number.parseInt(group.id.replace('bd-', ''), 10);
    result = capBoundaryLoops(
      state.mesh,
      state.analysis,
      all ? null : [loopIndex],
    );
    title = '封闭边界环';
    detail = `${result.changed} 个边界环 · 新增 ${result.addedFaces} 个 synthetic 面`;
    if (result.changed === 0) {
      toast('未执行封口', '当前边界环少于 3 个顶点', 'warning');
      return;
    }
  }

  commit(result.mesh, result.removed || removed, title, detail);
}

function setRevision(revision) {
  if (revision < 0 || revision >= state.revisions.length) return;
  state.activeRevision = revision;
  state.mesh = cloneMesh(state.revisions[revision].mesh);
  refresh({ fit: false });
}

function showExportMenu() {
  ui.exportMenu.hidden = false;
  const analysis = analyzeMesh(state.mesh);
  const reasons = [];
  if (analysis.stats.boundaryEdges) {
    reasons.push(`${analysis.stats.boundaryLoops} 个开放边界环`);
  }
  if (analysis.stats.nonManifoldEdges) {
    reasons.push(`${analysis.stats.nonManifoldEdges} 条非流形边`);
  }
  ui.exportState.innerHTML = `
    <span class="export-status ${analysis.closed ? 'closed' : 'open'}">${
      analysis.closed ? 'CLOSED_SOLID' : analysis.kind
    }</span>
    <p>${
      analysis.closed
        ? '当前网格满足封闭条件，可导出封闭 OBJ。'
        : `封闭导出已锁定：${reasons.join('、')}。可导出保留全部面的可渲染 OBJ。`
    }</p>
  `;
  const closedButton = document.querySelector('#export-closed');
  closedButton.disabled = !analysis.closed;
  closedButton.classList.toggle('disabled', !analysis.closed);
}

function closeExportMenu() {
  ui.exportMenu.hidden = true;
}

function performExport(mode) {
  const analysis = analyzeMesh(state.mesh);
  const safeName =
    state.mesh.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'trimesh';
  if (mode === 'closed') {
    if (!analysis.closed) {
      toast('无法导出封闭网格', '当前结果仍有边界或非流形边', 'warning');
      return;
    }
    downloadText(`${safeName}-closed.obj`, exportOBJ(state.mesh, { mode: 'closed' }));
    closeExportMenu();
    toast('封闭 OBJ 已导出', `${state.mesh.faces.length} 个三角面`, 'success');
  }
  if (mode === 'renderable') {
    downloadText(
      `${safeName}-renderable.obj`,
      exportOBJ(state.mesh, { mode: 'renderable' }),
    );
    closeExportMenu();
    toast('可渲染 OBJ 已导出', '保留全部现有面，不声明封闭', 'success');
  }
  if (mode === 'report') {
    const report = buildRepairReport({
      mesh: state.mesh,
      analysis,
      removed: currentRevision().removed,
      history: state.history,
      activeRevision: state.activeRevision,
      sample: state.sample,
    });
    downloadText(
      `${safeName}-repair-report.json`,
      JSON.stringify(report, null, 2),
      'application/json;charset=utf-8',
    );
    closeExportMenu();
    toast('映射报告已导出', '包含源面映射、撤销步骤与删除记录', 'success');
  }
}

async function importFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const mesh = parseOBJ(text, file.name);
    startScene(mesh, null, null);
  } catch (error) {
    toast('导入失败', error.message || '无法解析 OBJ', 'warning');
  }
}

document.addEventListener('click', (event) => {
  const defectButton = event.target.closest('[data-defect]');
  if (defectButton) {
    const defect = state.defects.find((item) => item.key === defectButton.dataset.defect);
    if (defect?.count > 0) {
      state.selection = {
        key: defect.key,
        groupId: defect.groups[0]?.id || null,
      };
      renderAll();
    } else if (defect) {
      toast('该类无缺陷', `${defect.title} 当前无检测项`, 'success');
    }
    return;
  }

  const groupButton = event.target.closest('[data-group]');
  if (groupButton) {
    state.selection.groupId = groupButton.dataset.group;
    renderAll();
    return;
  }

  const legendItem = event.target.closest('[data-key]');
  if (legendItem) {
    const defect = state.defects.find((item) => item.key === legendItem.dataset.key);
    if (defect) {
      state.selection = {
        key: defect.key,
        groupId: defect.groups[0]?.id || null,
      };
      renderAll();
    }
    return;
  }

  const action = event.target.closest('[data-action]');
  if (action) {
    if (action.dataset.action === 'fix' || action.dataset.action === 'fixAll') {
      executeFix(action.dataset.action);
    }
    if (action.dataset.action === 'keep') {
      const defect = activeDefect();
      if (defect?.key === 'nonmanifold') {
        toast('已保留非流形分支', '导出时将只开放可渲染 OBJ，不声明封闭', 'info');
      } else if (defect?.key === 'boundary') {
        toast('已保留开放边界', '封闭导出保持锁定，可导出可渲染 OBJ', 'info');
      } else {
        toast('未执行修改', '当前缺陷保持原样并继续显示', 'info');
      }
    }
    if (action.dataset.action === 'export') showExportMenu();
    return;
  }

  const historyRow = event.target.closest('[data-revision]');
  if (historyRow) {
    const target = Number.parseInt(historyRow.dataset.revision, 10);
    if (target !== state.activeRevision) {
      setRevision(target);
      toast(
        target === 0 ? '已回到原始输入' : `已回到修复步骤 ${target}`,
        `当前源面映射 ${buildFaceCorrespondence(
          state.mesh,
          currentRevision().removed,
        ).filter((entry) => entry.status === 'preserved').length}/${
          state.mesh.sourceFaceCount
        }`,
        'info',
      );
    }
    return;
  }

  const sampleButton = event.target.closest('[data-sample]');
  if (sampleButton) {
    const { sample, mesh } = loadSample(sampleButton.dataset.sample);
    startScene(mesh, sample, sample.id);
    return;
  }

  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    document
      .querySelectorAll('[data-view]')
      .forEach((button) => button.classList.toggle('active', button === viewButton));
    viewer.setView(viewButton.dataset.view);
    return;
  }

  if (event.target.closest('[data-fit]')) {
    viewer.fit();
    return;
  }

  const toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    const key = toggle.dataset.toggle;
    state.display[key] = !state.display[key];
    toggle.classList.toggle('active', state.display[key]);
    viewer.setDisplayOptions(state.display);
    return;
  }

  if (event.target.closest('#undo-button')) {
    if (state.activeRevision > 0) {
      setRevision(state.activeRevision - 1);
      toast('已撤销一步', `当前为 revision ${state.activeRevision}`, 'info');
    }
    return;
  }

  if (event.target.closest('#redo-button')) {
    if (state.activeRevision < state.revisions.length - 1) {
      setRevision(state.activeRevision + 1);
      toast('已重做一步', `当前为 revision ${state.activeRevision}`, 'info');
    }
    return;
  }

  if (event.target.closest('#refresh-button')) {
    refresh({ fit: false });
    toast('重新分析完成', `${state.defects.filter((item) => item.count).length} 类缺陷`, 'success');
    return;
  }

  if (event.target.closest('#import-button')) {
    document.querySelector('#file-input').click();
    return;
  }

  if (event.target.closest('#export-button')) {
    showExportMenu();
    return;
  }

  if (event.target.closest('#export-closed')) {
    performExport('closed');
    return;
  }

  if (event.target.closest('#export-renderable')) {
    performExport('renderable');
    return;
  }

  if (event.target.closest('#export-report')) {
    performExport('report');
    return;
  }

  if (event.target.closest('[data-close-export]')) {
    closeExportMenu();
    return;
  }

  if (!event.target.closest('#export-menu') && !event.target.closest('#export-button')) {
    closeExportMenu();
  }
});

document.querySelector('#file-input').addEventListener('change', (event) => {
  importFile(event.target.files?.[0]);
  event.target.value = '';
});

const viewport = document.querySelector('#viewport');
viewport.addEventListener('dragover', (event) => {
  event.preventDefault();
  viewport.classList.add('dragging');
  ui.dropHint.classList.add('visible');
});
viewport.addEventListener('dragleave', (event) => {
  if (viewport.contains(event.relatedTarget)) return;
  viewport.classList.remove('dragging');
  ui.dropHint.classList.remove('visible');
});
viewport.addEventListener('drop', (event) => {
  event.preventDefault();
  viewport.classList.remove('dragging');
  ui.dropHint.classList.remove('visible');
  importFile(event.dataTransfer.files?.[0]);
});

window.addEventListener('keydown', (event) => {
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) {
      if (state.activeRevision < state.revisions.length - 1) {
        setRevision(state.activeRevision + 1);
      }
    } else if (state.activeRevision > 0) {
      setRevision(state.activeRevision - 1);
    }
  }
  if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey) {
    if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) viewer.fit();
  }
  if (event.key === 'Escape') closeExportMenu();
});

const initial = loadSample('shells');
startScene(initial.mesh, initial.sample, initial.sample.id);
