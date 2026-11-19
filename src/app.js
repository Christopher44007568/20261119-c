// 交互主控：拖拽框选、相机/规则切换、选择体可视化与判定理由面板

import { createScene } from './scene.js';
import { Renderer } from './renderer.js';
import { buildSelectionFromDrag, normalizeDrag, viewProjMatrix } from './marquee.js';
import { selectObjects } from './selection.js';
import { oracleClassify } from './oracle.js';

const viewport = { width: 960, height: 640 };

export function startApp() {
  const canvas = document.getElementById('view');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const renderer = new Renderer(canvas);
  const { objects, camera } = createScene();

  const state = {
    rule: document.querySelector('input[name="rule"]:checked').value,
    dragging: false,
    start: null,
    current: null,
    lastResult: null,
    log: [],
  };

  const $ = (id) => document.getElementById(id);

  function currentViewProj() {
    const view = camera.viewMatrix();
    const proj = camera.projectionMatrix(viewport.width, viewport.height);
    return { view, proj, viewProj: viewProjMatrix(view, proj) };
  }

  function evaluate() {
    if (!state.start || !state.current) return null;
    const built = buildSelectionFromDrag(state.start, state.current, viewport, camera);
    if (built.degenerate) return { built, rows: [] };
    const { viewProj } = currentViewProj();
    const rows = selectObjects(built.frustum, objects, state.rule, viewProj, viewport);
    // 独立 oracle 交叉验证
    for (const row of rows) {
      row.oracleStatus = oracleClassify(built.frustum, row.obb);
      row.oracleAgrees = row.oracleStatus === row.status;
    }
    return { built, rows, viewProj };
  }

  function render() {
    renderer.clear();
    const { viewProj } = currentViewProj();
    const result = state.lastResult;
    const selectedNames = new Set(
      result ? result.rows.filter((r) => r.selected).map((r) => r.name) : []
    );

    if (result?.built?.frustum) {
      renderer.drawFrustum(result.built.frustum, viewProj);
    }
    for (const obb of objects) {
      renderer.drawOBB(obb, viewProj, {
        selected: selectedNames.has(obb.name),
        dimmed: result && !selectedNames.has(obb.name),
      });
    }
    if (state.dragging && state.start && state.current) {
      const drag = normalizeDrag(state.start, state.current, viewport);
      renderer.drawScreenRect(drag.rect, drag.reversed, drag.clamped);
    } else if (result?.built?.drag) {
      const drag = result.built.drag;
      renderer.drawScreenRect(drag.rect, drag.reversed, drag.clamped);
    }
    updatePanel(result);
  }

  function updatePanel(result) {
    const info = $('volumeInfo');
    if (!result?.built?.frustum) {
      info.innerHTML = '<span class="muted">在画布上按住左键拖出矩形即可生成选择体</span>';
      $('objectRows').innerHTML = objects
        .map(
          (o) =>
            `<tr><td>${o.name}</td><td class="muted">待选择</td><td class="muted">—</td><td class="muted">—</td></tr>`
        )
        .join('');
      $('summary').textContent = '尚未框选';
      return;
    }
    const { frustum, ndcRect, drag } = result.built;
    const modeText = camera.mode === 'ortho' ? '正交长方体' : '透视平截头体';
    info.innerHTML = `
      <div>类型：<b>${modeText}</b>（${frustum.isOrtho ? 'orthographic' : 'perspective'}）</div>
      <div>NDC 矩形：x[${ndcRect.xmin.toFixed(3)}, ${ndcRect.xmax.toFixed(3)}]
        y[${ndcRect.ymin.toFixed(3)}, ${ndcRect.ymax.toFixed(3)}]</div>
      <div>拖拽：${drag.direction}${drag.clamped ? '，<b style="color:#ff9f43">含视口外坐标，已夹取</b>' : ''}</div>
      <div>六个半空间平面（向内）：
        <table class="planes"><tr><th>平面</th><th>法线</th><th>d</th></tr>
        ${frustum.planes
          .map(
            (p) =>
              `<tr><td>${p.label}</td><td>(${p.normal
                .map((v) => v.toFixed(2))
                .join(', ')})</td><td>${p.d.toFixed(2)}</td></tr>`
          )
          .join('')}
        </table>
      </div>`;

    const statusText = { contained: '完全包含', intersects: '相交', outside: '分离' };
    $('objectRows').innerHTML = result.rows
      .map((r) => {
        const cls = r.selected ? 'row-sel' : '';
        const agree = r.oracleAgrees ? '✓ 一致' : '✗ 不一致';
        const agreeCls = r.oracleAgrees ? 'agree' : 'disagree';
        return `<tr class="${cls}">
          <td>${r.name}</td>
          <td>${statusText[r.status]}${r.selected ? ' <b>★选中</b>' : ''}</td>
          <td class="${agreeCls}">oracle: ${statusText[r.oracleStatus]} ${agree}</td>
          <td class="reason">${r.reason}</td>
        </tr>`;
      })
      .join('');
    const n = result.rows.filter((r) => r.selected).length;
    const mismatches = result.rows.filter((r) => !r.oracleAgrees).length;
    $('summary').textContent =
      `规则=${state.rule === 'contain' ? '完全包含' : '相交'}，选中 ${n}/${objects.length} 个对象` +
      (mismatches ? `，⚠ oracle 不一致 ${mismatches} 处` : '，与独立几何判定全部一致');
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    state.dragging = true;
    state.start = pointerPos(e);
    state.current = state.start;
    canvas.setPointerCapture(e.pointerId);
    render();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!state.dragging) return;
    state.current = pointerPos(e);
    state.lastResult = evaluate();
    render();
  });

  function endDrag(e) {
    if (!state.dragging) return;
    state.dragging = false;
    state.current = pointerPos(e);
    state.lastResult = evaluate();
    render();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  document.querySelectorAll('input[name="rule"]').forEach((el) => {
    el.addEventListener('change', () => {
      state.rule = document.querySelector('input[name="rule"]:checked').value;
      state.lastResult = evaluate();
      render();
    });
  });

  $('cameraMode').addEventListener('change', (e) => {
    camera.mode = e.target.value;
    state.lastResult = evaluate();
    render();
  });

  $('resetBtn').addEventListener('click', () => {
    state.start = state.current = null;
    state.lastResult = null;
    render();
  });

  // 程序化场景按钮：用于复现测试用例（反向拖框 / 视口外 / 跨近平面 / 前后重叠）
  $('scenarioBtn').addEventListener('click', () => {
    const scenarios = buildScenarios();
    const key = $('scenarioSelect').value;
    const s = scenarios[key];
    state.start = s.start;
    state.current = s.current;
    state.lastResult = evaluate();
    render();
  });

  function buildScenarios() {
    const W = viewport.width;
    const H = viewport.height;
    return {
      reverse: { start: { x: 460, y: 440 }, current: { x: 140, y: 140 } },
      outside: { start: { x: -80, y: -60 }, current: { x: W + 120, y: H + 90 } },
      near: { start: { x: 540, y: 20 }, current: { x: 950, y: 420 } },
      overlap: { start: { x: 80, y: 100 }, current: { x: 460, y: 430 } },
    };
  }

  render();
}

if (typeof document !== 'undefined') {
  startApp();
}
