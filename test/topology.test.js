const assert = require('assert');
const Topo = require('../topology');
const Meshes = require('../meshes');

function assertMeshStats(mesh, label) {
  const adj = Topo.buildAdjacency(mesh);
  // 边数：3F = 2*内部边 + 边界边
  let boundary = 0;
  let internal = 0;
  for (const e of adj.edgeById.values()) {
    if (e.he2) internal++; else boundary++;
  }
  assert.strictEqual(internal * 2 + boundary, mesh.faces.length * 3,
    label + ': 半边计数 2E内+E界=3F');
  const loops = Topo.boundaryLoops(adj);
  let loopEdges = 0;
  for (const loop of loops) loopEdges += loop.length;
  assert.strictEqual(loopEdges, boundary, label + ': 边界环覆盖全部边界边');
  return { adj, boundary, loops, internal };
}

function run() {
  // ---------- 圆环：闭、可定向、无边界 ----------
  const torus = Meshes.makeTorus(24, 14);
  let info = assertMeshStats(torus, '圆环');
  let prop = Topo.propagate(info.adj);
  assert.strictEqual(prop.orientable, true, '圆环可定向');
  assert.strictEqual(prop.conflicts.length, 0);
  assert.strictEqual(info.boundary, 0, '圆环无边界');
  assert.strictEqual(info.loops.length, 0);
  assert.strictEqual(Topo.shortestReversingLoop(info.adj), null,
    '圆环不存在反向环');
  assert.strictEqual(Topo.componentCount(info.adj), 1);
  // 欧拉示性数 V-E+F = 0
  assert.strictEqual(info.adj.V - info.adj.E + info.adj.F, 0, '圆环 χ=0');

  // ---------- 环形带：带边界、可定向、2 条边界环 ----------
  const annulus = Meshes.makeAnnulus(24, 4);
  info = assertMeshStats(annulus, '环形带');
  prop = Topo.propagate(info.adj);
  assert.strictEqual(prop.orientable, true, '环形带可定向');
  assert.strictEqual(info.loops.length, 2, '环形带有 2 条边界环');
  assert.strictEqual(Topo.shortestReversingLoop(info.adj), null);

  // ---------- 莫比乌斯带：带边界、不可定向、1 条边界环 ----------
  const mobius = Meshes.makeMobius(28, 4);
  info = assertMeshStats(mobius, '莫比乌斯带');
  const adjM = info.adj;
  prop = Topo.propagate(adjM);
  assert.strictEqual(prop.orientable, false, '莫比乌斯带不可定向');
  assert.ok(prop.conflicts.length > 0, '应检出方向冲突');
  assert.strictEqual(info.loops.length, 1, '莫比乌斯带只有 1 条边界环');

  const loop = Topo.shortestReversingLoop(adjM);
  assert.ok(loop, '莫比乌斯带存在反向环');
  assert.ok(loop.steps.every((s) => {
    const e = [...adjM.edgeById.values()][s.edgeId];
    return e.id === s.edgeId;
  }));
  // 环上 rev=1 的边数必须为奇数（这才是“反向”的含义）；
  // 注意 rev=1 的“边数”取决于网格离散，奇偶性才是不变量。
  let odd = 0;
  for (const s of loop.steps) odd += s.rev;
  assert.strictEqual(odd % 2, 1, '矛盾环上翻转边数为奇数');
  // 路径面连续
  for (let i = 1; i < loop.faces.length; i++) {
    assert.notStrictEqual(loop.faces[i - 1], loop.faces[i]);
  }

  // ---------- 翻转实验：翻转冲突面不能消除不可定向性 ----------
  const conflictFaces = new Set(prop.conflicts.map((c) => c.f));
  const flipped = Topo.flipFaces(mobius, conflictFaces);
  const adjF = Topo.buildAdjacency(flipped);
  const propF = Topo.propagate(adjF);
  assert.strictEqual(propF.orientable, false,
    '简单翻转几个面后仍不可定向');
  const loopF = Topo.shortestReversingLoop(adjF);
  assert.ok(loopF, '翻转后矛盾环依然存在');

  // 不变量：任意环上 rev 奇偶性与面翻转无关
  const parityBefore = loop.steps.reduce((a, s) => a ^ s.rev, 0);
  const parityAfter = loopF.steps.reduce((a, s) => a ^ s.rev, 0);
  assert.strictEqual(parityBefore, 1);
  assert.strictEqual(parityAfter, 1, '反向环的奇偶性是拓扑不变量');

  // ---------- 可定向双覆盖 ----------
  const cover = Topo.buildDoubleCover(mobius, adjM);
  const adjC = Topo.buildAdjacency(cover);
  const propC = Topo.propagate(adjC);
  assert.strictEqual(propC.orientable, true, '双覆盖可定向');
  assert.strictEqual(propC.conflicts.length, 0);
  assert.strictEqual(cover.faces.length, mobius.faces.length * 2,
    '覆盖面数 = 2F');
  assert.strictEqual(Topo.componentCount(adjC), 1,
    '不可定向曲面的双覆盖连通（单连通分量）');
  assert.strictEqual(Topo.shortestReversingLoop(adjC), null,
    '覆盖上无反向环');

  // 邻接数量检查：3*2F = 2*E内 + E界
  let cInternal = 0;
  let cBoundary = 0;
  for (const e of adjC.edgeById.values()) {
    if (e.he2) cInternal++; else cBoundary++;
  }
  assert.strictEqual(cInternal * 2 + cBoundary, cover.faces.length * 3,
    '覆盖半边计数自洽');
  const sourceInternal = adjM.edgeById.size - info.boundary;
  assert.strictEqual(cInternal, sourceInternal * 2,
    '覆盖内部边 = 2 × 原内部边');
  assert.strictEqual(cBoundary, info.boundary * 2,
    '覆盖边界边 = 2 × 原边界边');

  const coverLoops = Topo.boundaryLoops(adjC);
  assert.strictEqual(coverLoops.length, 2,
    '莫比乌斯双覆盖有 2 条边界环（原 1 条边界被提升为两条）');
  // 伙伴面一一对应
  for (let f = 0; f < cover.faces.length; f++) {
    assert.strictEqual(cover.facePartner[cover.facePartner[f]], f);
  }

  // ---------- 可定向网格的双覆盖：两个不连通拷贝 ----------
  const coverT = Topo.buildDoubleCover(torus, Topo.buildAdjacency(torus));
  const adjCT = Topo.buildAdjacency(coverT);
  assert.strictEqual(Topo.componentCount(adjCT), 2,
    '可定向曲面的双覆盖是两个连通分量');
  assert.strictEqual(Topo.propagate(adjCT).orientable, true);

  // ---------- 克莱因瓶：闭合、不可定向，双覆盖是连通的可定向曲面（环面）----------
  const klein = Meshes.makeKlein(24, 16);
  const adjK = Topo.buildAdjacency(klein);
  assert.strictEqual(adjK.boundaryHEs.length, 0, '克莱因瓶无边界');
  assert.strictEqual(Topo.propagate(adjK).orientable, false, '克莱因瓶不可定向');
  assert.ok(Topo.shortestReversingLoop(adjK), '克莱因瓶存在反向环');
  assert.strictEqual(adjK.V - adjK.E + adjK.F, 0, '克莱因瓶 χ=0');
  const coverK = Topo.buildDoubleCover(klein, adjK);
  const adjCK = Topo.buildAdjacency(coverK);
  assert.strictEqual(Topo.propagate(adjCK).orientable, true, '克莱因双覆盖可定向');
  assert.strictEqual(Topo.componentCount(adjCK), 1, '克莱因双覆盖连通');
  assert.strictEqual(adjCK.V - adjCK.E + adjCK.F, 0, '双覆盖 χ=0（环面）');
  assert.strictEqual(adjCK.boundaryHEs.length, 0, '双覆盖仍闭合');
  assert.strictEqual(coverK.faces.length, klein.faces.length * 2);
  assert.strictEqual(coverK.vertices.length, klein.vertices.length * 2);

  console.log('全部拓扑断言通过 ✓');
  console.log('莫比乌斯: F=%d 最短矛盾环长度=%d (翻转边 %d 条)',
    mobius.faces.length, loop.length, odd);
  console.log('双覆盖: F=%d V=%d 内部边=%d 边界边=%d 边界环=%d',
    cover.faces.length, cover.vertices.length, cInternal, cBoundary,
    coverLoops.length);
}

run();
