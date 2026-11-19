// 深度排序：CPU 全排序（参照）与稳定的分桶计数排序。
// 渲染约定：从远到近（z 大 -> z 小）做 over 混合。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PBSort = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // 参照实现：每帧完整 CPU 排序。tie 时按 id 打破平局，保证确定性。
  function fullSortOrder(particles) {
    const order = particles.map(function (p) { return p.id; });
    order.sort(function (a, b) {
      const za = particles[a].z;
      const zb = particles[b].z;
      if (za > zb) return -1;
      if (za < zb) return 1;
      return a - b;
    });
    return order;
  }

  // 每个桶当前粒子数，用于 HUD 展示负载均衡。
  function bucketCounts(particles, bucketCount) {
    const counts = new Array(bucketCount).fill(0);
    for (let i = 0; i < particles.length; i += 1) {
      counts[particles[i].bucket] += 1;
    }
    return counts;
  }

  // 稳定计数排序：桶从远到近输出；桶内保留粒子在原数组中的相对顺序，
  // 因此同深度粒子（连续帧 id 顺序不变）顺序天然稳定，无需每帧重排。
  function bucketSortOrder(particles, bucketCount, options) {
    const withinBucket = options && options.withinBucket;
    const counts = bucketCounts(particles, bucketCount);
    // 桶号越大越远；over 混合要求远桶先输出，因此从高桶号开始铺排。
    const offsets = new Array(bucketCount);
    let total = 0;
    for (let b = bucketCount - 1; b >= 0; b -= 1) {
      offsets[b] = total;
      total += counts[b];
    }
    const order = new Array(particles.length);
    const cursor = offsets.slice();
    for (let i = 0; i < particles.length; i += 1) {
      const b = particles[i].bucket;
      order[cursor[b]] = particles[i].id;
      cursor[b] += 1;
    }
    if (withinBucket === 'id') {
      // 扫描模式：桶内按全排序规则（z 降序、id 平局）做二次排序，
      // 消除量化碰撞造成的次序歧义；桶足够细时与全排序严格等价。
      for (let b = bucketCount - 1; b >= 0; b -= 1) {
        order.slice(offsets[b], offsets[b] + counts[b])
          .sort(function (a, c) {
            const za = particles[a].z;
            const zc = particles[c].z;
            if (za > zc) return -1;
            if (za < zc) return 1;
            return a - c;
          })
          .forEach(function (id, k) {
            order[offsets[b] + k] = id;
          });
      }
    }
    return { order: order, counts: counts, offsets: offsets };
  }

  // 统计 z 严格反转的粒子对数（等深粒子不计）。
  // 分桶误差的结构性度量：与混合产生的像素误差互补。
  function countInversions(particles, order) {
    const zs = order.map(function (id) { return particles[id].z; });
    const ids = order.slice();
    const tmpZ = new Array(zs.length);
    const tmpId = new Array(zs.length);
    let inversions = 0;

    function merge(lo, mid, hi) {
      let i = lo;
      let j = mid;
      let k = lo;
      while (i < mid && j < hi) {
        if (zs[i] >= zs[j]) {
          tmpZ[k] = zs[i];
          tmpId[k] = ids[i];
          i += 1;
        } else {
          // zs[j] 本应更靠前却靠后：它跳过了 mid-i 个更深的粒子。
          inversions += mid - i;
          tmpZ[k] = zs[j];
          tmpId[k] = ids[j];
          j += 1;
        }
        k += 1;
      }
      while (i < mid) {
        tmpZ[k] = zs[i];
        tmpId[k] = ids[i];
        i += 1;
        k += 1;
      }
      while (j < hi) {
        tmpZ[k] = zs[j];
        tmpId[k] = ids[j];
        j += 1;
        k += 1;
      }
      for (let t = lo; t < hi; t += 1) {
        zs[t] = tmpZ[t];
        ids[t] = tmpId[t];
      }
    }

    (function sort(lo, hi) {
      if (hi - lo <= 1) return;
      const mid = (lo + hi) >> 1;
      sort(lo, mid);
      sort(mid, hi);
      merge(lo, mid, hi);
    })(0, zs.length);
    return inversions;
  }

  return {
    fullSortOrder: fullSortOrder,
    bucketSortOrder: bucketSortOrder,
    bucketCounts: bucketCounts,
    countInversions: countInversions,
  };
});
