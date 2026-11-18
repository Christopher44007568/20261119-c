/*
 * meshes.js — 对照网格参数化生成器
 * 全部为三角剖分流形，顶点顺序保持参数化方向；莫比乌斯带在接缝处
 * 按“扭转半圈”规则缝合，其 rev=1 边由邻接关系自然体现。
 */
(function (global) {
  'use strict';

  const TopoNS = global.Topo ||
    (typeof require !== 'undefined' ? require('./topology') : null);
  const UnionFindCtor = TopoNS ? TopoNS.UnionFind : null;

  function makeTorus(nu, nv) {
    nu = nu || 24;
    nv = nv || 14;
    const R = 2.0;
    const r = 0.85;
    const vertices = [];
    const vid = (i, j) => ((i % nu) * nv + (j % nv));
    for (let i = 0; i < nu; i++) {
      const u = (i / nu) * Math.PI * 2;
      for (let j = 0; j < nv; j++) {
        const v = (j / nv) * Math.PI * 2;
        const rr = R + r * Math.cos(v);
        vertices.push([
          rr * Math.cos(u),
          rr * Math.sin(u),
          r * Math.sin(v),
        ]);
      }
    }
    const faces = [];
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = vid(i, j);
        const b = vid(i + 1, j);
        const c = vid(i + 1, j + 1);
        const d = vid(i, j + 1);
        faces.push([a, b, c]);
        faces.push([a, c, d]);
      }
    }
    return { name: 'torus', vertices, faces, kind: 'closed' };
  }

  function makeAnnulus(nu, nv) {
    nu = nu || 24;
    nv = nv || 4;
    const rIn = 1.1;
    const rOut = 2.4;
    const vertices = [];
    const vid = (i, j) => ((i % nu) * (nv + 1) + j);
    for (let i = 0; i < nu; i++) {
      const u = (i / nu) * Math.PI * 2;
      for (let j = 0; j <= nv; j++) {
        const t = j / nv;
        const radius = rIn + t * (rOut - rIn);
        vertices.push([
          radius * Math.cos(u),
          radius * Math.sin(u),
          0,
        ]);
      }
    }
    const faces = [];
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = vid(i, j);
        const b = vid(i + 1, j);
        const c = vid(i + 1, j + 1);
        const d = vid(i, j + 1);
        faces.push([a, b, c]);
        faces.push([a, c, d]);
      }
    }
    return { name: 'annulus', vertices, faces, kind: 'boundary' };
  }

  /*
   * 莫比乌斯带：u 方向在 i=nu 处扭转半圈缝合，
   * 即 (i=nu, j) 与 (i=0, nv-j) 是同一个点。
   */
  function makeMobius(nu, nv) {
    nu = nu || 28;
    // 宽度分段取偶数：在 (nu,v)~(0,nv-v) 扭转识别下，
    // 偶数宽度保证单条边界环（莫比乌斯带的定义特征）。
    nv = nv || 4;
    const R = 2.0;
    const w = 0.8;

    // 1) 参数域顶点：i=0..nu（nu 与 0 经扭转缝合），j=0..nv
    const p = (i, j) => {
      const u = (i / nu) * Math.PI * 2;
      const t = (j / nv) * 2 - 1;
      const half = (w * t) / 2;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      return [
        (R + half * Math.cos(u / 2)) * cu,
        (R + half * Math.cos(u / 2)) * su,
        half * Math.sin(u / 2),
      ];
    };

    // 2) 顶点合并映射：seam(nu, j) 与 (0, nv-j) 同点；用并查集保证一致
    const id = (i, j) => i * (nv + 1) + j;
    const uf = new UnionFindCtor((nu + 1) * (nv + 1));
    for (let j = 0; j <= nv; j++) uf.union(id(nu, j), id(0, nv - j));
    const rootToVertex = new Map();
    const vertexOf = new Int32Array((nu + 1) * (nv + 1));
    const vertices = [];
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const root = uf.find(id(i, j));
        let v = rootToVertex.get(root);
        if (v === undefined) {
          v = vertices.length;
          rootToVertex.set(root, v);
          vertices.push(p(i, j));
        }
        vertexOf[id(i, j)] = v;
      }
    }

    // 3) 面：始终沿用参数域 (u,v) 的固定定向，扭转只体现在顶点合并里
    const faces = [];
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = vertexOf[id(i, j)];
        const b = vertexOf[id(i + 1, j)];
        const c = vertexOf[id(i + 1, j + 1)];
        const d = vertexOf[id(i, j + 1)];
        faces.push([a, b, c]);
        faces.push([a, c, d]);
      }
    }
    return { name: 'mobius', vertices, faces, kind: 'boundary' };
  }

  /*
   * 克莱因瓶：参数矩形 u∈[0,2π), v∈[0,2π)，
   * u 方向反向缝合 (nu,j)~(0,nv-j)，v 方向普通缝合。
   * 这是闭合、不可定向曲面；其可定向双覆盖是环面。
   * 浸入 R3 的标准参数化（自交仅为可视化，不影响拓扑）。
   */
  function makeKlein(nu, nv) {
    nu = nu || 24;
    nv = nv || 16;
    const pos = (u, v) => {
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      if (u < Math.PI) {
        const x = (2.5 + Math.cos(u / 2) * sv - Math.sin(u / 2) * Math.sin(2 * v)) * cu;
        const y = (2.5 + Math.cos(u / 2) * sv - Math.sin(u / 2) * Math.sin(2 * v)) * su;
        const z = Math.sin(u / 2) * sv + Math.cos(u / 2) * Math.sin(2 * v);
        return [x, y, z];
      }
      const x = (2.5 + Math.cos(u / 2) * sv + Math.sin(u / 2) * Math.sin(2 * v)) * cu;
      const y = (2.5 + Math.cos(u / 2) * sv + Math.sin(u / 2) * Math.sin(2 * v)) * su;
      const z = Math.sin(u / 2) * sv - Math.cos(u / 2) * Math.sin(2 * v);
      return [x, y, z * -1 + cv];
    };

    const N = (nu + 1) * (nv + 1);
    const vid = (i, j) => i * (nv + 1) + j;
    const vpos = [];
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        vpos.push(pos((i / nu) * Math.PI * 2, (j / nv) * Math.PI * 2));
      }
    }

    const pfaces = [];
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = vid(i, j);
        const b = vid(i + 1, j);
        const c = vid(i + 1, j + 1);
        const d = vid(i, j + 1);
        pfaces.push([a, b, c]);
        pfaces.push([a, c, d]);
      }
    }

    // u 方向反向缝合 (nu,j)~(0,nv-j)；v 方向普通缝合 (i,nv)~(i,0)
    const uf = new UnionFindCtor(N);
    for (let j = 0; j <= nv; j++) uf.union(vid(nu, j), vid(0, nv - j));
    for (let i = 0; i <= nu; i++) uf.union(vid(i, nv), vid(i, 0));

    const r2v = new Map();
    const remap = new Int32Array(N);
    const vertices = [];
    for (let i = 0; i < N; i++) {
      const root = uf.find(i);
      let v = r2v.get(root);
      if (v === undefined) {
        v = vertices.length;
        r2v.set(root, v);
        vertices.push(vpos[i]);
      }
      remap[i] = v;
    }
    const faces = pfaces.map((fc) => fc.map((x) => remap[x]));
    return { name: 'klein', vertices, faces, kind: 'closed' };
  }

  global.Meshes = { makeTorus, makeAnnulus, makeMobius, makeKlein };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.Meshes;
}
