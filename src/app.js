// Application controller: owns the fold-angle state, drives the rigid solver,
// keeps the last ACCEPTED pose when a candidate is rejected, and wires the
// renderer and HUD together.

import { Renderer } from './render/renderer.js';
import { OrbitCamera } from './render/camera.js';
import { buildScene } from './render/scene.js';
import { solveFold, validatePattern } from './core/folding.js';
import { fourFoldStrip, degreeFourLoop } from './core/patterns.js';

const RAD_TO_DEG = 180 / Math.PI;

class FoldPreviewer {
  constructor() {
    this.canvas = document.getElementById('viewport');
    this.renderer = new Renderer(this.canvas);
    this.camera = new OrbitCamera([2.2, 0, 0.4], 7.5);
    this.camera.attach(this.canvas);
    this.pattern = fourFoldStrip();
    this.state = {};
    this.lastAcceptedResult = null;
    this.lastAcceptedState = {};
    this.activeFoldId = null;
    this.showNormals = true;
    this.bindUi();
    this.loadPattern(this.pattern);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  bindUi() {
    document.getElementById('patternSelect').addEventListener('change', (e) => {
      const next = e.target.value === 'loop' ? degreeFourLoop() : fourFoldStrip();
      this.loadPattern(next);
    });
    document.getElementById('resetBtn').addEventListener('click', () => {
      this.state = Object.fromEntries(this.pattern.folds.map((f) => [f.id, 0]));
      this.syncSliders();
      this.evaluate(true);
    });
    document.getElementById('normalToggle').addEventListener('change', (e) => {
      this.showNormals = e.target.checked;
    });
    document.getElementById('loadJsonBtn').addEventListener('click', () => {
      this.loadCustomPattern();
    });
    this.pointerActive = false;
    window.addEventListener('pointerup', () => {
      this.pointerActive = false;
      this.activeFoldId = null;
      if (this.lastAcceptedState) {
        this.state = { ...this.lastAcceptedState };
        this.syncSliders();
      }
    });
  }

  loadPattern(pattern) {
    const error = validatePattern(pattern);
    if (error) {
      this.setStatus(`折痕图无效：${error}`, true);
      return;
    }
    this.pattern = pattern;
    this.state = Object.fromEntries(pattern.folds.map((f) => [f.id, 0]));
    this.lastAcceptedResult = null;
    this.activeFoldId = null;
    this.buildSliders();
    this.evaluate(true);
  }

  buildSliders() {
    const host = document.getElementById('foldControls');
    host.innerHTML = '';
    for (const fold of this.pattern.folds) {
      const row = document.createElement('label');
      row.className = 'fold-row';
      const tag = fold.assignment === 'M' ? '山折 M' : '谷折 V';
      row.innerHTML = `
        <span class="fold-id">${fold.id}
          <em class="${fold.assignment === 'M' ? 'tag-m' : 'tag-v'}">${tag}</em>
        </span>
        <input type="range" min="0" max="180" step="1" value="0" data-fold="${fold.id}">
        <span class="fold-value" data-value="${fold.id}">0°</span>
      `;
      const input = row.querySelector('input');
      input.addEventListener('pointerdown', () => {
        this.pointerActive = true;
        this.activeFoldId = fold.id;
      });
      input.addEventListener('input', () => {
        this.activeFoldId = fold.id;
        this.state[fold.id] = Number(input.value) * (Math.PI / 180);
        row.querySelector(`[data-value="${fold.id}"]`).textContent = `${input.value}°`;
        this.evaluate(false);
      });
      host.appendChild(row);
    }
  }

  syncSliders() {
    for (const fold of this.pattern.folds) {
      const input = document.querySelector(`[data-fold="${fold.id}"]`);
      const value = document.querySelector(`[data-value="${fold.id}"]`);
      if (!input) continue;
      const degrees = Math.round((this.state[fold.id] ?? 0) * RAD_TO_DEG);
      input.value = degrees;
      value.textContent = `${degrees}°`;
    }
  }

  evaluate(forceAccept) {
    const candidate = solveFold(this.pattern, this.state);
    if (!candidate.ok) {
      this.setStatus(`求解失败：${candidate.error}`, true);
      return;
    }
    if (candidate.accepted || forceAccept) {
      this.lastAcceptedResult = candidate;
      this.lastAcceptedState = { ...this.state };
    }
    this.updateHud(candidate);
  }

  updateHud(result) {
    const closureRows = result.closure
      .map((c) => {
        const posFail = c.positionResidual > result.posTol;
        const angFail = c.angleResidual > result.angleTol;
        return `<tr class="${posFail || angFail ? 'bad' : 'good'}">
          <td>${c.foldId}</td>
          <td>${c.positionResidual.toExponential(3)}</td>
          <td>${(c.angleResidual * RAD_TO_DEG).toFixed(3)}°</td>
        </tr>`;
      })
      .join('');
    document.getElementById('closureBody').innerHTML =
      closureRows || '<tr><td colspan="3" class="muted">无闭环（无环面板邻接图）</td></tr>';
    document.getElementById('lengthDelta').textContent =
      `${(result.lengths.maxRelative * 100).toExponential(3)}%`;
    document.getElementById('intersectionList').textContent =
      result.intersections.length
        ? result.intersections.map((v) => v.panels.join('↔')).join('，')
        : '无';
    const banner = document.getElementById('statusBanner');
    if (result.accepted) {
      banner.className = 'status ok';
      banner.textContent = '状态满足刚体与闭环约束，已接受该折叠姿态';
    } else {
      banner.className = 'status reject';
      banner.textContent = `已拒绝：${result.reasons.join('；')}（画面保留上一有效姿态）`;
    }
  }

  setStatus(message, isError) {
    const banner = document.getElementById('statusBanner');
    banner.className = isError ? 'status reject' : 'status ok';
    banner.textContent = message;
  }

  loadCustomPattern() {
    const text = document.getElementById('jsonInput').value;
    try {
      const parsed = JSON.parse(text);
      this.loadPattern(parsed);
    } catch (err) {
      this.setStatus(`JSON 解析失败：${err.message}`, true);
    }
  }

  loop() {
    const shown = this.lastAcceptedResult;
    if (shown) {
      const viewProj = this.renderer.frameMatrix(this.camera);
      const scene = buildScene(this.pattern, shown, {
        activeFoldId: this.pointerActive ? this.activeFoldId : null,
        showNormals: this.showNormals,
      });
      this.renderer.draw(viewProj, this.camera.eye, scene.fill, scene.lines);
    }
    requestAnimationFrame(this.loop);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.foldPreviewer = new FoldPreviewer();
});
