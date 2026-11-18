/*
 * app.js — 交互编排：方向传播、矛盾环、双覆盖、翻转实验
 */
(function () {
  'use strict';

  const canvas = document.getElementById('canvas');
  const renderer = new MeshRenderer(canvas);
  const $ = (id) => document.getElementById(id);

  const state = {
    meshName: 'mobius',
    sourceMesh: null,
    adj: null,
    prop: null,
    loop: null,
    mode: 'propagate', // propagate | loop | cover | flip
    cover: null,
    coverAdj: null,
    coverProp: null,
    flipped: false,
    explode: 0,
    selectedStep: -1,
    selectedFace: null,
  };

  const builders = {
    torus: () => Meshes.makeTorus(26, 16),
    annulus: () => Meshes.makeAnnulus(26, 4),
    mobius: () => Meshes.makeMobius(30, 4),
    klein: () => Meshes.makeKlein(24, 16),
  };

  function loadMesh(name) {
    state.meshName = name;
    state.flipped = false;
    state.cover = null;
    state.loop = null;
    state.selectedStep = -1;
    state.selectedFace = null;
    state.mode = 'propagate';
    rebuild();
  }

  function resizeCanvas() {
    const view = document.getElementById('view');
    const dpr = window.devicePixelRatio || 1;
    const w = view.clientWidth;
    const h = view.clientHeight;
    canvas.width = Math.max(320, Math.floor(w * dpr));
    canvas.height = Math.max(320, Math.floor(h * dpr));
    if (renderer.mesh) renderer.setMesh(renderer.mesh);
    draw();
  }
  window.addEventListener('resize', resizeCanvas);

  function rebuild() {
    const mesh = builders[state.meshName]();
    state.sourceMesh = mesh;
    state.adj = Topo.buildAdjacency(mesh);
    state.prop = Topo.propagate(state.adj);
    state.loop = Topo.shortestReversingLoop(state.adj);
    applyMode('propagate');
  }

  function currentDisplayMesh() {
    if (state.mode === 'cover' && state.cover) {
      return applyExplode(state.cover);
    }
    return state.sourceMesh;
  }

  // 双覆盖沿法向“炸开”两层，便于观察对应关系
  function applyExplode(cover) {
    if (state.explode <= 0) return cover;
    const F = state.sourceMesh.faces.length;
    const verts = cover.vertices.map((v) => v.slice());
    const offset = state.explode * 0.9;
    for (let f = 0; f < F; f++) {
      const fc = state.sourceMesh.faces[f];
      const a = state.sourceMesh.vertices[fc[0]];
      const b = state.sourceMesh.vertices[fc[1]];
      const c = state.sourceMesh.vertices[fc[2]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = normalize([
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ]);
      for (let layer = 0; layer < 2; layer++) {
        for (let slot = 0; slot < 3; slot++) {
          const cid = cover.cornerOf(f, layer, slot);
          const vi = cover.cornerVertex[cid];
          const sign = layer === 0 ? 1 : -1;
          verts[vi][0] += n[0] * offset * sign;
          verts[vi][1] += n[1] * offset * sign;
          verts[vi][2] += n[2] * offset * sign;
        }
      }
    }
    return { vertices: verts, faces: cover.faces };
  }

  function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  // ---------- 相机交互 ----------
  let dragging = false;
  let last = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    renderer.yaw += dx * 0.008;
    renderer.pitch = Math.max(-1.4, Math.min(1.4, renderer.pitch + dy * 0.008));
    last = { x: e.clientX, y: e.clientY };
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    renderer.zoom = Math.max(0.4, Math.min(3, renderer.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    draw();
  }, { passive: false });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const face = renderer.pick(x, y);
    if (face !== null) onFaceClick(face);
  });

  // ---------- 模式与着色 ----------
  const COLOR_KEEP = [110, 150, 200];   // 保持存储方向
  const COLOR_FLIP = [236, 150, 92];    // 需要翻转
  const COLOR_CONFLICT = [255, 90, 90]; // 冲突面
  const COLOR_L0 = [96, 178, 255];
  const COLOR_L1 = [178, 120, 255];

  function applyMode(mode) {
    state.mode = mode;
    state.selectedStep = -1;
    state.selectedFace = null;
    if (mode === 'cover') {
      if (!state.cover) {
        state.cover = Topo.buildDoubleCover(state.sourceMesh, state.adj);
        state.coverAdj = Topo.buildAdjacency(state.cover);
        state.coverProp = Topo.propagate(state.coverAdj);
      }
    } else if (mode === 'flip' && !state.flipped) {
      const conflictFaces = new Set(state.prop.conflicts.map((c) => c.f));
      const flippedMesh = Topo.flipFaces(state.sourceMesh, conflictFaces);
      state.sourceMesh = flippedMesh;
      state.adj = Topo.buildAdjacency(flippedMesh);
      state.prop = Topo.propagate(state.adj);
      state.loop = Topo.shortestReversingLoop(state.adj);
      state.flipped = true;
      state.cover = null;
    }
    configureRenderer();
    draw();
    renderPanels();
    syncButtons();
  }

  function configureRenderer() {
    renderer.highlightEdges = new Set();
    renderer.hotEdges = new Set();
    renderer.highlightFaces = new Set();
    renderer._hl = null;

    if (state.mode === 'cover') {
      renderer.setMesh(currentDisplayMesh());
      renderer.faceColor = (f) =>
        state.cover.faceLayer[f] === 0 ? COLOR_L0 : COLOR_L1;
      renderer.edgeColor = () => 'rgba(20,26,36,0.5)';
      return;
    }

    renderer.setMesh(state.sourceMesh);
    const conflictFaces = new Set();
    for (const c of state.prop.conflicts) {
      conflictFaces.add(c.f);
      conflictFaces.add(c.g);
    }

    renderer.faceColor = (f, shade) => {
      if (state.mode === 'loop' && state.loop && state.loop.faces.includes(f)) {
        return [255, 210, 70];
      }
      if (conflictFaces.has(f)) return COLOR_CONFLICT;
      const s = state.prop.sign[f];
      const base = s === 1 ? COLOR_FLIP : COLOR_KEEP;
      return base;
    };
    renderer.edgeColor = (f) => 'rgba(20,26,36,0.45)';

    if (state.mode === 'loop' && state.loop) {
      for (const edgeId of state.loop.edges) {
        const edge = [...state.adj.edgeById.values()].find((e) => e.id === edgeId);
        renderer.highlightEdges.add(edge.he1.a + '|' + edge.he1.b);
      }
    }
  }

  function draw() {
    if (state.mode === 'cover') renderer.setMesh(currentDisplayMesh());
    renderer.render();
    if (state.mode === 'cover' && state.cover) drawCorrespondence();
  }

  // 双覆盖两层对应关系：连接伙伴面的质心
  function drawCorrespondence() {
    if (state.explode < 0.05) return;
    const ctx = canvas.getContext('2d');
    const mesh = currentDisplayMesh();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.2;
    for (let f = 0; f < state.sourceMesh.faces.length; f += 2) {
      const c0 = faceCentroid(mesh, f * 2);
      const c1 = faceCentroid(mesh, f * 2 + 1);
      const p0 = renderer.project(renderer.rotate(c0));
      const p1 = renderer.project(renderer.rotate(c1));
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function faceCentroid(mesh, f) {
    const fc = mesh.faces[f];
    const c = [0, 0, 0];
    for (const vi of fc) {
      c[0] += mesh.vertices[vi][0];
      c[1] += mesh.vertices[vi][1];
      c[2] += mesh.vertices[vi][2];
    }
    return [c[0] / 3, c[1] / 3, c[2] / 3];
  }

  function syncButtons() {
    const map = {
      propagate: 'btnPropagate',
      loop: 'btnLoop',
      cover: 'btnCover',
      flip: 'btnFlip',
    };
    for (const [mode, id] of Object.entries(map)) {
      $(id).classList.toggle('active', state.mode === mode);
    }
  }

  // ---------- 侧边栏 ----------
  function renderPanels() {
    renderVerdict();
    renderStats();
    renderLoopCard();
    renderCoverCard();
    renderFlipCard();
    $('detailCard').style.display = state.selectedFace === null ? 'none' : 'block';
    if (state.selectedFace !== null) renderDetail(state.selectedFace);
  }

  function renderVerdict() {
    const card = $('verdictCard');
    const ok = state.prop.orientable;
    const kindLabel = {
      torus: '圆环（闭合曲面）',
      annulus: '环形带（带边界曲面）',
      mobius: '莫比乌斯带（带边界曲面）',
      klein: '克莱因瓶（闭合曲面）',
    }[state.meshName];
    card.innerHTML = `
      <h2>诊断结论</h2>
      <div class="verdict ${ok ? 'ok' : 'no'}">
        ${ok ? '✓ 可定向：存在一致的面方向' : '✗ 不可定向：方向传播出现矛盾'}
      </div>
      <div class="row">
        <span class="pill">${kindLabel}</span>
        <span class="pill">冲突边 ${state.prop.conflicts.length}</span>
        <span class="pill">连通分量 ${Topo.componentCount(state.adj)}</span>
      </div>`;
  }

  function renderStats() {
    const adj = state.adj;
    const loops = Topo.boundaryLoops(adj);
    const chi = adj.V - adj.E + adj.F;
    const revCount = [...adj.edgeById.values()].filter((e) => e.rev === 1).length;
    $('statsCard').innerHTML = `
      <h2>网格统计</h2>
      <div class="stat"><span>顶点 V</span><b>${adj.V}</b></div>
      <div class="stat"><span>面 F（三角形）</span><b>${adj.F}</b></div>
      <div class="stat"><span>边 E</span><b>${adj.E}</b></div>
      <div class="stat"><span>需翻转的存储边 rev=1</span><b>${revCount}</b></div>
      <div class="stat"><span>边界边</span><b>${adj.boundaryHEs.length}</b></div>
      <div class="stat"><span>边界环数</span><b>${loops.length}</b></div>
      <div class="stat"><span>欧拉示性数 V−E+F</span><b>${chi}</b></div>
      <div class="legend">
        <span><span class="swatch" style="background:rgb(${COLOR_KEEP.join(',')})"></span>保持 sign=0</span>
        <span><span class="swatch" style="background:rgb(${COLOR_FLIP.join(',')})"></span>翻转 sign=1</span>
        <span><span class="swatch" style="background:rgb(${COLOR_CONFLICT.join(',')})"></span>冲突面</span>
      </div>`;
  }

  function renderLoopCard() {
    const card = $('loopCard');
    if (state.mode !== 'loop') { card.style.display = 'none'; return; }
    card.style.display = 'block';
    if (!state.loop) {
      card.innerHTML = '<h2>最短矛盾环</h2><p class="note">未找到反向环——网格可定向。</p>';
      return;
    }
    const stepsHtml = state.loop.steps.map((s, i) => {
      const edge = edgeById(s.edgeId);
      const revText = s.rev === 1
        ? '<span class="fail">rev=1（跨边翻转）</span>'
        : '<span class="ok2">rev=0（保持）</span>';
      return `<div class="step ${state.selectedStep === i ? 'sel' : ''}" data-step="${i}">
        <div>第 ${i + 1} 步：面 ${s.f} → 面 ${s.g}</div>
        <div class="tag">边 ${edge.he1.a}–${edge.he1.b} · ${revText}
        · 约束 sign[${s.g}] = sign[${s.f}] ⊕ ${s.rev}</div>
      </div>`;
    }).join('');
    const oddEdges = state.loop.steps.filter((s) => s.rev === 1).length;
    card.innerHTML = `
      <h2>最短矛盾环（长度 ${state.loop.length}）</h2>
      <p class="note">在双层状态图 (面, 奇偶) 上 BFS 求得。回到起点时奇偶性为
      <b>1</b>，环上 rev=1 边 ${oddEdges} 条（奇数），因此沿环传播一周后方向自相矛盾。
      点击任一步骤在 3D 视图定位该边。</p>
      <div>${stepsHtml}</div>`;
    card.querySelectorAll('.step').forEach((el) => {
      el.addEventListener('click', () => selectStep(Number(el.dataset.step)));
    });
  }

  function edgeById(id) {
    return [...state.adj.edgeById.values()].find((e) => e.id === id);
  }

  function selectStep(i) {
    state.selectedStep = i;
    const s = state.loop.steps[i];
    const edge = edgeById(s.edgeId);
    const all = new Set();
    for (const eid of state.loop.edges) {
      const e = edgeById(eid);
      all.add(e.he1.a + '|' + e.he1.b);
    }
    renderer.highlightEdges = all;
    renderer.hotEdges = new Set([edge.he1.a + '|' + edge.he1.b]);
    renderer.highlightFaces = new Set([s.f, s.g]);
    renderer._hl = '#ffd23d';
    draw();
    renderLoopCard();
    renderDetailForEdge(s);
  }

  function renderDetailForEdge(s) {
    const edge = edgeById(s.edgeId);
    const info = state.adj.neighbors[s.f].find((x) => x.edgeId === s.edgeId);
    const signF = state.prop.sign[s.f];
    const want = signF ^ s.rev;
    $('detailCard').style.display = 'block';
    $('detailCard').innerHTML = `
      <h2>边传播约束</h2>
      <div class="kv mono">
      共享边：顶点 ${edge.he1.a} → ${edge.he1.b}<br>
      面 ${s.f} 的 sign = <b>${signF}</b><br>
      邻接关系 rev = <b>${s.rev}</b>（${s.rev ? '存储方向相同，需翻转' : '存储方向相反，保持'}）<br>
      传播要求 sign[${s.g}] = ${signF} ⊕ ${s.rev} = <b>${want}</b><br>
      BFS 实际写入 sign[${s.g}] = <b>${state.prop.sign[s.g]}</b><br>
      约束公式：<b>sign[邻居] = sign[面] XOR rev</b>
      </div>`;
  }

  function renderDetail(f) {
    const adj = state.adj;
    const sign = state.mode === 'cover' ? state.coverProp.sign : state.prop.sign;
    const usedAdj = state.mode === 'cover' ? state.coverAdj : adj;
    const rows = usedAdj.neighbors[f].map((info) => {
      const want = sign[f] ^ info.rev;
      const actual = sign[info.nb];
      const clash = want !== actual ? '<span class="fail">冲突!</span>' : '<span class="ok2">一致</span>';
      return `<div class="step">
        面 ${f} → 面 ${info.nb} · rev=${info.rev}
        <div class="tag">要求 sign[${info.nb}]=${want}，实际 ${actual} ${clash}</div>
      </div>`;
    }).join('');
    $('detailCard').innerHTML = `
      <h2>面 ${f} 的传播约束</h2>
      <div class="kv">当前 sign = <b>${sign[f]}</b>（${sign[f] ? '翻转存储方向' : '保持存储方向'}）</div>
      <div style="margin-top:8px">${rows || '<p class="note">该面无内部邻接（孤立或全边界）。</p>'}</div>`;
  }

  function onFaceClick(face) {
    state.selectedFace = face;
    if (state.mode === 'loop' && state.loop) {
      const idx = state.loop.steps.findIndex((s) => s.f === face || s.g === face);
      if (idx >= 0) { selectStep(idx); return; }
    }
    renderer.highlightFaces = new Set([face]);
    renderer._hl = '#ffd23d';
    draw();
    renderDetail(face);
  }

  function renderCoverCard() {
    const card = $('coverCard');
    if (state.mode !== 'cover' || !state.cover) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    const src = state.adj;
    const cov = state.coverAdj;
    const srcLoops = Topo.boundaryLoops(src);
    const covLoops = Topo.boundaryLoops(cov);
    let srcInternal = 0;
    let srcBoundary = 0;
    for (const e of src.edgeById.values()) e.he2 ? srcInternal++ : srcBoundary++;
    let covInternal = 0;
    let covBoundary = 0;
    for (const e of cov.edgeById.values()) e.he2 ? covInternal++ : covBoundary++;
    const checks = [
      ['覆盖面数 = 2F', state.cover.faces.length === src.F * 2,
        `${state.cover.faces.length} vs 2×${src.F}`],
      ['覆盖可定向（无冲突）', state.coverProp.orientable,
        `冲突 ${state.coverProp.conflicts.length}`],
      ['覆盖无反向环', Topo.shortestReversingLoop(cov) === null, 'BFS 双层状态图'],
      ['内部边 = 2 × 原内部边', covInternal === srcInternal * 2,
        `${covInternal} vs 2×${srcInternal}`],
      ['边界边 = 2 × 原边界边', covBoundary === srcBoundary * 2,
        `${covBoundary} vs 2×${srcBoundary}`],
      [srcLoops.length === 1 ? '边界环 1 → 2（单边界提升两次）' : '边界环数翻倍',
        covLoops.length === srcLoops.length * 2,
        `${srcLoops.length} → ${covLoops.length}`],
    ];
    const rows = checks.map(([label, pass, detail]) => `
      <div class="stat"><span>${pass ? '✓' : '✗'} ${label}</span>
      <b class="${pass ? 'ok2' : 'fail'}">${detail}</b></div>`).join('');
    card.innerHTML = `
      <h2>可定向双覆盖核对</h2>
      <p class="note">每个原面生成两个带层标签的提升面，沿内部边按
      <span class="mono">sign[邻居]=sign[面]⊕rev</span> 粘合角点（并查集），
      不是简单复制顶点或翻转几个面。两层用颜色区分，虚线为伙伴面对应关系。</p>
      ${rows}
      <div class="explode-wrap">
        <span class="kv">炸开两层</span>
        <input type="range" id="explodeRange" min="0" max="1" step="0.01" value="${state.explode}">
      </div>
      <div class="legend">
        <span><span class="swatch" style="background:rgb(${COLOR_L0.join(',')})"></span>第 0 层</span>
        <span><span class="swatch" style="background:rgb(${COLOR_L1.join(',')})"></span>第 1 层</span>
      </div>`;
    $('explodeRange').addEventListener('input', (e) => {
      state.explode = Number(e.target.value);
      draw();
    });
  }

  function renderFlipCard() {
    const card = $('flipCard');
    if (state.mode !== 'flip') { card.style.display = 'none'; return; }
    card.style.display = 'block';
    const conflictFaces = new Set(state.prop.conflicts.map((c) => c.f));
    const flipped = Topo.flipFaces(state.sourceMesh, conflictFaces);
    const adj2 = Topo.buildAdjacency(flipped);
    const prop2 = Topo.propagate(adj2);
    const loop2 = Topo.shortestReversingLoop(adj2);
    card.innerHTML = `
      <h2>翻转实验：为什么“翻几个面”修不好</h2>
      <p class="note">把 BFS 报出的 ${conflictFaces.size} 个冲突面全部翻转后重新传播：</p>
      <div class="stat"><span>翻转后是否可定向</span>
        <b class="${prop2.orientable ? 'ok2' : 'fail'}">${prop2.orientable ? '是' : '否'}</b></div>
      <div class="stat"><span>翻转后冲突边</span>
        <b class="fail">${prop2.conflicts.length}</b></div>
      <div class="stat"><span>最短反向环</span>
        <b class="${loop2 ? 'fail' : 'ok2'}">${loop2 ? '仍存在，长度 ' + loop2.length : '无'}</b></div>
      <p class="note">翻转一个面只改变它与相邻面的局部 rev 关系，
      但任意闭合面环上 rev=1 边数的<b>奇偶性</b>是拓扑不变量。
      莫比乌斯带的矛盾环含奇数条翻转边，无论如何翻面都消不掉；
      真正的修复只能靠双覆盖把曲面变成两层的可定向流形。</p>`;
  }

  // ---------- 工具栏 ----------
  $('meshSelect').addEventListener('change', (e) => loadMesh(e.target.value));
  $('btnPropagate').addEventListener('click', () => applyMode('propagate'));
  $('btnLoop').addEventListener('click', () => applyMode('loop'));
  $('btnCover').addEventListener('click', () => applyMode('cover'));
  $('btnFlip').addEventListener('click', () => applyMode('flip'));
  $('btnReset').addEventListener('click', () => {
    renderer.yaw = 0.6;
    renderer.pitch = 0.35;
    renderer.zoom = 1;
    state.explode = 0;
    loadMesh($('meshSelect').value);
  });

  resizeCanvas();
  loadMesh('mobius');

  window.OrientApp = {
    state,
    loadMesh,
    applyMode,
    draw: () => draw(),
    onFaceClick: (f) => onFaceClick(f),
  };
})();
