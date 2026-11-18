/*
 * topology.js — 网格可定向性诊断的纯拓扑核心（无 DOM 依赖，可在 Node 中测试）
 *
 * 网格约定：
 *   mesh = { vertices: [[x,y,z], ...], faces: [[a,b,c], ...] }
 *   每个面为三角形，顶点顺序即该面的“存储方向”。
 */
(function (global) {
  'use strict';

  function edgeKey(a, b, V) {
    return a < b ? a * V + b : b * V + a;
  }

  // 并查集：双覆盖构造时用于合并角点归属
  function UnionFind(n) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  UnionFind.prototype.find = function (x) {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== x) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  };
  UnionFind.prototype.union = function (x, y) {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx !== ry) this.parent[ry] = rx;
  };

  /*
   * 构建半边邻接。
   * 返回：
   *   V, F, E
   *   neighbors[f] = [{ edgeId, nb, rev, slot, nbSlot }]
   *     rev=0 两个面沿共享边方向相反（存储方向一致，邻居保持即可）
   *     rev=1 两个面沿共享边方向相同（存储方向冲突，邻居必须翻转）
   *   halfEdges: 每条半边 { face, slot, a, b, key, mate }
   *   boundaryHEs: 无配对的半边（边界边）
   *   edgeById: Map key -> { id, he1, he2|null, rev }
   */
  function buildAdjacency(mesh) {
    const V = mesh.vertices.length;
    const F = mesh.faces.length;
    const halfEdges = [];
    const byKey = new Map();
    const edgeById = new Map();
    let edgeSeq = 0;

    for (let f = 0; f < F; f++) {
      const fc = mesh.faces[f];
      for (let slot = 0; slot < 3; slot++) {
        const a = fc[slot];
        const b = fc[(slot + 1) % 3];
        const he = { face: f, slot, a, b, key: edgeKey(a, b, V), mate: null };
        halfEdges.push(he);
        if (!byKey.has(he.key)) byKey.set(he.key, []);
        byKey.get(he.key).push(he);
      }
    }

    const neighbors = Array.from({ length: F }, () => []);
    const boundaryHEs = [];

    for (const [key, list] of byKey) {
      const edge = { id: edgeSeq++, key, he1: list[0], he2: null, rev: 0 };
      if (list.length === 1) {
        boundaryHEs.push(list[0]);
      } else if (list.length === 2) {
        const [h1, h2] = list;
        h1.mate = h2;
        h2.mate = h1;
        // 方向相反 => 存储方向一致(rev=0)；方向相同 => 需要翻转(rev=1)
        const rev = h1.a === h2.a && h1.b === h2.b ? 1 : 0;
        edge.he2 = h2;
        edge.rev = rev;
        neighbors[h1.face].push({
          edgeId: edge.id, nb: h2.face, rev,
          slot: h1.slot, nbSlot: h2.slot,
        });
        neighbors[h2.face].push({
          edgeId: edge.id, nb: h1.face, rev,
          slot: h2.slot, nbSlot: h1.slot,
        });
      } else {
        throw new Error('非流形边：边 ' + key + ' 被 ' + list.length + ' 个面共享');
      }
      edgeById.set(key, edge);
    }

    return {
      V, F, E: edgeSeq, halfEdges, neighbors,
      boundaryHEs, edgeById, byKey,
    };
  }

  /*
   * 从 rootFace 传播一致方向。
   * sign[f]=0 表示面保持存储方向，1 表示需要翻转。
   * 约束：sign[nb] = sign[f] XOR rev
   * 返回 { orientable, sign, roots, conflicts, order, edgeConstraint(f, nbInfo) }
   * conflicts: 检测到冲突的邻接关系（同一面被两种状态要求）
   */
  function propagate(adj, rootFace) {
    const F = adj.F;
    const sign = new Int8Array(F).fill(-1);
    const roots = [];
    const conflicts = [];
    const order = [];
    const parent = new Int32Array(F).fill(-1);
    const parentEdge = new Int32Array(F).fill(-1);
    const queue = [];

    function startComponent(root) {
      roots.push(root);
      sign[root] = 0;
      parent[root] = -1;
      queue.push(root);
      order.push(root);
      while (queue.length) {
        const f = queue.shift();
        for (const info of adj.neighbors[f]) {
          const want = sign[f] ^ info.rev;
          if (sign[info.nb] === -1) {
            sign[info.nb] = want;
            parent[info.nb] = f;
            parentEdge[info.nb] = info.edgeId;
            queue.push(info.nb);
            order.push(info.nb);
          } else if (sign[info.nb] !== want) {
            conflicts.push({
              edgeId: info.edgeId,
              f, g: info.nb, rev: info.rev,
              signF: sign[f], signG: sign[info.nb], want,
            });
          }
        }
      }
    }

    if (rootFace === undefined) {
      for (let f = 0; f < F; f++) {
        if (sign[f] === -1) startComponent(f);
      }
    } else {
      startComponent(rootFace);
    }

    return {
      orientable: conflicts.length === 0,
      sign, roots, conflicts, order, parent, parentEdge,
      // 沿 (f -> g) 边对 g 的状态要求
      edgeConstraint(info, signF) {
        return signF ^ info.rev;
      },
    };
  }

  /*
   * 最短矛盾环（最短反向面环）。
   * 在状态图 (face, parity) 上，从每个 (f,0) 做 BFS，找回到同一面 (f,1)
   * 的最短路径，取全局最短。parity 是路径上 rev=1 边的条数奇偶性；
   * 可定向网格不存在这样的环。
   * 返回 { faces:[...], edges:[edgeId...], steps:[{f,g,edgeId,rev}], length } 或 null
   */
  function shortestReversingLoop(adj) {
    const F = adj.F;
    let best = null;

    for (let src = 0; src < F; src++) {
      const prev = new Int32Array(F * 2).fill(-1);
      const prevEdge = new Int32Array(F * 2).fill(-1);
      const prevRev = new Int8Array(F * 2).fill(-1);
      const start = src * 2; // (src, parity 0)
      prev[start] = start;
      const queue = [start];
      let head = 0;
      let hit = -1;
      while (head < queue.length && hit === -1) {
        const cur = queue[head++];
        const f = cur >> 1;
        const p = cur & 1;
        for (const info of adj.neighbors[f]) {
          const np = p ^ info.rev;
          const nst = info.nb * 2 + np;
          if (prev[nst] !== -1) continue;
          prev[nst] = cur;
          prevEdge[nst] = info.edgeId;
          prevRev[nst] = info.rev;
          if (info.nb === src && np === 1) { hit = nst; break; }
          queue.push(nst);
        }
      }
      if (hit === -1) continue;
      const steps = [];
      let cur = hit;
      while (cur !== start) {
        const f = prev[cur] >> 1;
        const g = cur >> 1;
        steps.push({ f, g, edgeId: prevEdge[cur], rev: prevRev[cur] });
        cur = prev[cur];
      }
      steps.reverse();
      if (!best || steps.length < best.steps.length) {
        best = {
          root: src,
          steps,
          length: steps.length,
          faces: [src, ...steps.map((s) => s.g)],
          edges: steps.map((s) => s.edgeId),
        };
      }
    }
    return best;
  }

  /*
   * 沿边界半边追踪边界环。
   * 标准半边置换：边界半边 h=(a,b) 的后继 =
   *   同面下一条半边 (b,c) 的配对半边，不断跨越直到再次落到边界。
   * 这能正确处理莫比乌斯带“边界在扭转顶点经过同一顶点两次”的情形。
   * 返回 [[heIndex, ...], ...]，每个环按半边衔接顺序排列。
   */
  function boundaryLoops(adj) {
    const faceSlotHE = new Map();
    for (const he of adj.halfEdges) {
      faceSlotHE.set(he.face * 3 + he.slot, he);
    }
    const successor = (he) => {
      let cur = he;
      for (;;) {
        const nxt = faceSlotHE.get(cur.face * 3 + ((cur.slot + 1) % 3));
        if (!nxt.mate) return nxt;
        cur = nxt.mate;
      }
    };
    const loops = [];
    const seen = new Set();
    for (const start of adj.boundaryHEs) {
      if (seen.has(start)) continue;
      const loop = [];
      let he = start;
      do {
        seen.add(he);
        loop.push(adj.halfEdges.indexOf(he));
        he = successor(he);
      } while (he && he !== start);
      loops.push(loop);
    }
    return loops;
  }

  // 返回翻转指定面集合后的新网格（不修改原网格）
  function flipFaces(mesh, faceSet) {
    const faces = mesh.faces.map((fc, f) => {
      if (!faceSet.has(f)) return fc.slice();
      return [fc[0], fc[2], fc[1]];
    });
    return { vertices: mesh.vertices, faces };
  }

  // 连通分量数（面邻接图）
  function componentCount(adj) {
    const seen = new Uint8Array(adj.F);
    let count = 0;
    for (let s = 0; s < adj.F; s++) {
      if (seen[s]) continue;
      count++;
      seen[s] = 1;
      const queue = [s];
      while (queue.length) {
        const f = queue.pop();
        for (const info of adj.neighbors[f]) {
          if (!seen[info.nb]) { seen[info.nb] = 1; queue.push(info.nb); }
        }
      }
    }
    return count;
  }

  /*
   * 可定向双覆盖（orientation double cover）。
   * 不做“复制顶点 + 硬连”的假构造：每个覆盖面 (f,层) 的三个角点先各自独立，
   * 再沿内部边用并查集粘合，使覆盖网格自然成为合法流形。
   *
   * 角点编号 cid(f,层,slot) = (f*2+层)*3+slot，共 6F 个。
   * 覆盖面 (f,L) 沿内部边与覆盖面 (g, L XOR rev) 相遇：
   *   按实际顶点相等配对两端（rev=0 起点对起点，rev=1 起点对终点）。
   * 第二层面反向写入，覆盖整体因此可定向；不可定向原网格的覆盖连通，
   * 可定向原网格的覆盖则分裂为两个拷贝。
   */
  function buildDoubleCover(mesh, adj) {
    const F = mesh.faces.length;
    const V = mesh.vertices.length;
    const cornerOf = (f, layer, slot) => (f * 2 + layer) * 3 + slot;
    const uf = new UnionFind(F * 6);

    for (const edge of adj.edgeById.values()) {
      if (!edge.he2) continue; // 边界边在覆盖中也保持为边界
      const h1 = edge.he1;
      const h2 = edge.he2;
      const r = edge.rev;
      const f = h1.face;
      const g = h2.face;
      const s0 = h1.slot;
      const s1 = (h1.slot + 1) % 3;
      const t0 = h2.slot;
      const t1 = (h2.slot + 1) % 3;
      for (let layer = 0; layer < 2; layer++) {
        const otherLayer = layer ^ r;
        // 按半边实际顶点相等决定端点配对，避免 slot 假设
        const tStart = h2.a === h1.a ? t0 : t1;
        const tEnd = h2.b === h1.b ? t1 : t0;
        uf.union(cornerOf(f, layer, s0), cornerOf(g, otherLayer, tStart));
        uf.union(cornerOf(f, layer, s1), cornerOf(g, otherLayer, tEnd));
      }
    }

    // 根 -> 覆盖网格顶点号
    const rootToId = new Map();
    const coverVertices = [];
    const coverBaseVertex = [];
    const coverLayer = [];
    const cornerVertex = new Int32Array(F * 6);
    for (let f = 0; f < F; f++) {
      for (let layer = 0; layer < 2; layer++) {
        for (let slot = 0; slot < 3; slot++) {
          const c = cornerOf(f, layer, slot);
          const root = uf.find(c);
          let id = rootToId.get(root);
          if (id === undefined) {
            id = coverVertices.length;
            rootToId.set(root, id);
            coverBaseVertex.push(mesh.faces[f][slot]);
            coverLayer.push(layer);
            coverVertices.push(mesh.vertices[mesh.faces[f][slot]].slice());
          }
          cornerVertex[c] = id;
        }
      }
    }

    const coverFaces = [];
    const faceLayer = [];
    for (let f = 0; f < F; f++) {
      coverFaces.push([
        cornerVertex[cornerOf(f, 0, 0)],
        cornerVertex[cornerOf(f, 0, 1)],
        cornerVertex[cornerOf(f, 0, 2)],
      ]);
      faceLayer.push(0);
      // 第二层反向：保证两个提升方向在覆盖边处一致
      coverFaces.push([
        cornerVertex[cornerOf(f, 1, 1)],
        cornerVertex[cornerOf(f, 1, 0)],
        cornerVertex[cornerOf(f, 1, 2)],
      ]);
      faceLayer.push(1);
    }

    const cover = {
      vertices: coverVertices,
      faces: coverFaces,
      faceLayer,
      baseVertex: coverBaseVertex,
      layer: coverLayer,
      facePartner: Array.from({ length: F * 2 }, (_, i) =>
        i % 2 === 0 ? i + 1 : i - 1),
      baseFace: Array.from({ length: F * 2 }, (_, i) => i >> 1),
      cornerVertex,
      cornerOf,
      sourceV: V,
      sourceF: F,
    };
    return cover;
  }

  global.Topo = {
    edgeKey,
    UnionFind,
    buildAdjacency,
    propagate,
    shortestReversingLoop,
    boundaryLoops,
    flipFaces,
    componentCount,
    buildDoubleCover,
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.Topo;
}
