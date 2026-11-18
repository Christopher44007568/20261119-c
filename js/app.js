/*
 * app.js — 应用主控：组装渲染流水线并绑定交互
 *
 * 严格的流水线顺序：
 *   眼睛空间顶点 -> 投影矩阵 -> 裁剪空间顶点（不做除法）
 *   -> 六平面齐次 Sutherland-Hodgman 裁剪（属性沿边插值）
 *   -> 透视除法 -> 视口映射 -> 屏幕光栅化
 */
(function () {
  'use strict';

  var state = AppState.createState();
  var cam3d = Views.makeCamera3D();
  var topMapper = null;
  var dragIdx = -1;

  var c3 = document.getElementById('view3d');
  var cTop = document.getElementById('topView');
  var cScreen = document.getElementById('screenView');
  var ctx3 = c3.getContext('2d');
  var ctxTop = cTop.getContext('2d');
  var ctxScreen = cScreen.getContext('2d');

  function projection() {
    var f = state.frustum;
    return Mat.perspective(f.fovyDeg * Math.PI / 180, f.aspect, f.near, f.far);
  }

  // 完整执行一次流水线并返回各阶段产物
  function runPipeline() {
    var P = projection();
    var clipInput = state.eyeVerts.map(function (e, i) {
      var c = Mat.eyeToClip(P, e);
      c.sourceIdx = i;
      return c;
    });
    var result = Clip.clipPolygon(clipInput);
    result.vertices.forEach(function (v) {
      v.generated = !!v.onPlane;
    });
    var invP = Mat.invert4(P);
    var clippedEye = result.vertices.map(function (c) {
      var e = Mat.clipToEye(invP, c);
      e.generated = c.generated;
      return e;
    });
    var originalEyeArea = Mat.eyeArea(state.eyeVerts);
    var clippedEyeArea = result.rejected ? 0 : Mat.eyeArea(clippedEye);
    return {
      P: P, clipInput: clipInput, result: result,
      clippedEye: clippedEye,
      originalEyeArea: originalEyeArea,
      clippedEyeArea: clippedEyeArea
    };
  }

  function render() {
    var pipe = runPipeline();
    Views.drawView3D(ctx3, c3.width, c3.height, cam3d, state.frustum,
      state.eyeVerts, pipe.clippedEye, state.selected);
    topMapper = Views.drawTopView(ctxTop, cTop.width, cTop.height,
      state.frustum, state.eyeVerts, state.selected);
    var screenVerts = Views.drawScreen(ctxScreen, cScreen.width, cScreen.height,
      pipe.result.vertices, pipe.result.rejected, {
        perspectiveCorrect: state.perspectiveCorrect,
        checker: state.checker
      });
    updatePanels(pipe, screenVerts);
  }

  function fmt(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return Number(n).toFixed(digits == null ? 3 : digits);
  }

  function updatePanels(pipe, screenVerts) {
    var r = pipe.result;
    var status = document.getElementById('pipeStatus');
    if (r.rejected) {
      status.textContent = '结果：整个三角形被拒绝（输出 0 个顶点）';
      status.className = 'status bad';
    } else {
      status.textContent = '结果：输出 ' + r.outputCount + ' 个顶点（含 ' +
        r.vertices.filter(function (v) { return v.generated; }).length + ' 个裁剪交点）';
      status.className = 'status ok';
    }

    // 每平面统计表
    var planeRows = r.perPlane.map(function (s) {
      return '<tr><td>' + s.plane + '</td><td>' + s.inCount + '</td><td>' +
        s.intersections + '</td><td>' + s.outCount + '</td></tr>';
    }).join('');
    document.getElementById('planeStats').innerHTML =
      '<tr><th>平面</th><th>输入</th><th>新交点</th><th>输出</th></tr>' + planeRows;

    // 面积变化
    var ndcBefore = Clip.ndcArea(pipe.clipInput);
    var ndcAfter = r.rejected ? 0 : Clip.ndcArea(r.vertices);
    var pixelArea = polygonPixelArea(screenVerts);
    var ratio = ndcBefore > 1e-9 ? ndcAfter / ndcBefore : 0;
    document.getElementById('areaStats').innerHTML =
      '<tr><th>指标</th><th>裁剪前</th><th>裁剪后</th><th>保留比</th></tr>' +
      areaRow('眼睛空间面积', pipe.originalEyeArea, pipe.clippedEyeArea) +
      areaRow('NDC 面积', ndcBefore, ndcAfter) +
      '<tr><td>屏幕像素面积</td><td>—</td><td>' + fmt(pixelArea, 1) + ' px²</td><td>' +
      fmt(ratio, 4) + '</td></tr>';

    // 输出顶点表（裁剪空间 + NDC + 属性）
    var rows;
    if (r.rejected) {
      rows = '<tr><td colspan="9" class="muted">无输出顶点</td></tr>';
    } else {
      rows = r.vertices.map(function (c, i) {
        var ndc = Clip.perspectiveDivide(c, 1e-6);
        var tag = c.generated
          ? '<span class="gen">交点·' + c.onPlane + ' t=' + fmt(c.t, 3) + '</span>'
          : '<span class="orig">原 V' + c.sourceIdx + '</span>';
        var wWarn = Math.abs(c.w) < 1e-4 ? ' class="warn"' : '';
        return '<tr' + wWarn + '><td>' + i + '</td><td>' + tag + '</td>' +
          '<td>' + fmt(c.x) + '</td><td>' + fmt(c.y) + '</td><td>' + fmt(c.z) +
          '</td><td>' + fmt(c.w) + '</td>' +
          '<td>' + (ndc.valid ? fmt(ndc.x) : 'w≈0') + '</td><td>' +
          (ndc.valid ? fmt(ndc.y) : 'w≈0') + '</td><td>rgb(' +
          (c.r | 0) + ',' + (c.g | 0) + ',' + (c.b | 0) + ')</td></tr>';
      }).join('');
    }
    document.getElementById('vertexTable').innerHTML =
      '<tr><th>#</th><th>来源</th><th>x_c</th><th>y_c</th><th>z_c</th><th>w_c</th>' +
      '<th>x_n</th><th>y_n</th><th>插值颜色</th></tr>' + rows;

    // 输入顶点的裁剪空间坐标（强调除法前的原始值）
    var inRows = pipe.clipInput.map(function (c, i) {
      var warn = c.w <= 1e-4 ? ' class="warn"' : '';
      return '<tr' + warn + '><td>V' + i + '</td><td>' + fmt(c.x) + '</td><td>' +
        fmt(c.y) + '</td><td>' + fmt(c.z) + '</td><td>' + fmt(c.w) + '</td></tr>';
    }).join('');
    document.getElementById('inputTable').innerHTML =
      '<tr><th>顶点</th><th>x_c</th><th>y_c</th><th>z_c</th><th>w_c</th></tr>' + inRows;

    updateSliders();
  }

  function areaRow(name, before, after) {
    var ratio = before > 1e-9 ? after / before : 0;
    return '<tr><td>' + name + '</td><td>' + fmt(before) + '</td><td>' +
      fmt(after) + '</td><td>' + fmt(ratio, 4) + '</td></tr>';
  }

  function polygonPixelArea(verts) {
    if (!verts || verts.length < 3) return 0;
    var sum = 0;
    for (var i = 0; i < verts.length; i++) {
      var p = verts[i], q = verts[(i + 1) % verts.length];
      sum += p.sx * q.sy - q.sx * p.sy;
    }
    return Math.abs(sum) * 0.5;
  }

  // ---------- 交互 ----------
  function updateSliders() {
    var v = state.eyeVerts[state.selected];
    ['x', 'y', 'z'].forEach(function (axis) {
      var slider = document.getElementById('sl-' + axis);
      var num = document.getElementById('num-' + axis);
      slider.value = v[axis];
      num.value = v[axis].toFixed(3);
    });
    document.querySelectorAll('.vertex-pick').forEach(function (btn, i) {
      btn.classList.toggle('active', i === state.selected);
    });
  }

  function bindControls() {
    document.querySelectorAll('.vertex-pick').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selected = parseInt(btn.dataset.idx, 10);
        render();
      });
    });
    ['x', 'y', 'z'].forEach(function (axis) {
      var slider = document.getElementById('sl-' + axis);
      slider.addEventListener('input', function () {
        state.eyeVerts[state.selected][axis] = parseFloat(slider.value);
        render();
      });
    });
    document.getElementById('chk-correct').addEventListener('change', function (e) {
      state.perspectiveCorrect = e.target.checked;
      render();
    });
    document.getElementById('chk-checker').addEventListener('change', function (e) {
      state.checker = e.target.checked;
      render();
    });
    document.getElementById('chk-sweep').addEventListener('change', function (e) {
      state.sweep = e.target.checked;
      state.sweepDir = -1;
    });
    document.querySelectorAll('.preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.preset;
        state.eyeVerts = AppState.cloneVerts(AppState.PRESETS[key].verts);
        state.preset = key;
        state.selected = 0;
        render();
      });
    });
    bindTopDrag();
    bindOrbit();
  }

  function mousePos(canvas, e) {
    var rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (canvas.width / rect.width),
             y: (e.clientY - rect.top) * (canvas.height / rect.height) };
  }

  function bindTopDrag() {
    cTop.addEventListener('mousedown', function (e) {
      var m = mousePos(cTop, e);
      for (var i = 0; i < state.eyeVerts.length; i++) {
        var p = topMapper.toScreen(state.eyeVerts[i].x, state.eyeVerts[i].z);
        if (Math.hypot(p.x - m.x, p.y - m.y) < 12) {
          dragIdx = i;
          state.selected = i;
          return;
        }
      }
    });
    window.addEventListener('mousemove', function (e) {
      if (dragIdx < 0) return;
      var m = mousePos(cTop, e);
      var world = topMapper.toWorld(m.x, m.y);
      state.eyeVerts[dragIdx].x = clamp(world.x, -30, 30);
      state.eyeVerts[dragIdx].z = clamp(world.z, -40, 8);
      render();
    });
    window.addEventListener('mouseup', function () { dragIdx = -1; });
  }

  function bindOrbit() {
    var dragging = false, last = null;
    c3.addEventListener('mousedown', function (e) {
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      cam3d.yaw += (e.clientX - last.x) * 0.01;
      cam3d.pitch = clamp(cam3d.pitch + (e.clientY - last.y) * 0.01, -1.3, 1.3);
      last = { x: e.clientX, y: e.clientY };
      render();
    });
    window.addEventListener('mouseup', function () { dragging = false; });
    c3.addEventListener('wheel', function (e) {
      e.preventDefault();
      cam3d.dist = clamp(cam3d.dist + e.deltaY * 0.02, 8, 60);
      render();
    }, { passive: false });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // 近平面扫掠：让选中顶点沿 z 轴往返移动，穿过近平面与相机
  function sweepTick() {
    if (state.sweep) {
      var v = state.eyeVerts[state.selected];
      v.z += state.sweepDir * 0.08;
      if (v.z < -12) state.sweepDir = 1;
      if (v.z > 1.5) state.sweepDir = -1;
      render();
    }
    requestAnimationFrame(sweepTick);
  }

  bindControls();
  render();
  requestAnimationFrame(sweepTick);
})();
