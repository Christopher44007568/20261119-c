// 粒子模拟：交叉移动的两股粒子流 + 同深度粒子组。
// 同时维护原始深度 z、平滑深度 emaZ 与带迟滞的分桶归属。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PBSim = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const COLORS = {
    streamA: [255, 92, 120],
    streamB: [70, 170, 255],
    tie: [245, 210, 90],
  };

  function createParticles(count, width, height, rng) {
    const random = rng || Math.random;
    function rand(min, max) {
      return min + random() * (max - min);
    }
    const particles = [];
    const laneCount = 24;
    const tieLanes = [5, 11, 17, 23];
    const tieSet = new Set(tieLanes);
    const tiePerLane = Math.max(3, Math.round(count * 0.08 / tieLanes.length));
    const tieTotal = tiePerLane * tieLanes.length;
    const normalPerLane = Math.round((count - tieTotal) /
      (laneCount - tieLanes.length));
    let id = 0;

    for (let lane = 0; lane < laneCount; lane += 1) {
      const inTieLane = tieSet.has(lane);
      const laneSize = inTieLane ? tiePerLane : normalPerLane;
      for (let j = 0; j < laneSize && id < count; j += 1) {
        const group = inTieLane ? 'tie' : (lane % 2 === 0 ? 'A' : 'B');
        const p = {
          id: id,
          group: group,
          x: random() * width,
          y: (lane + 0.5) / laneCount * height + rand(-6, 6),
          z: 0,
          emaZ: 0,
          prevZ: 0,
          vx: 0,
          phase: random() * Math.PI * 2,
          zAmp: rand(0.22, 0.34),
          zSpeed: rand(0.18, 0.3),
          jitterPhase: random() * Math.PI * 2,
          bucket: -1,
          rawBucket: -1,
          migratedAt: -1,
          tieLane: inTieLane ? lane : -1,
        };
        if (group === 'A') p.vx = rand(14, 26);
        if (group === 'B') p.vx = -rand(14, 26);
        if (group === 'tie') p.vx = rand(-6, 6);
        particles.push(p);
        id += 1;
      }
    }
    return particles;
  }

  function laneBaseZ(lane) {
    return 0.5 + 0.32 * Math.sin(lane * 1.7);
  }

  // 无迟滞的原始分桶，便于对比迟滞效果。
  function bucketOf(z, bucketCount) {
    if (z <= 0) return 0;
    if (z >= 1) return bucketCount - 1;
    return Math.min(bucketCount - 1, Math.floor(z * bucketCount));
  }

  // 迟滞：只有当 emaZ 越过相邻桶边界额外一个 margin 时才迁移，
  // 抑制粒子在桶边界附近来回抖动。
  function hysteresisBucket(p, bucketCount, margin) {
    const raw = bucketOf(p.emaZ, bucketCount);
    if (p.bucket < 0) return raw;
    if (raw === p.bucket) return raw;
    const boundary = raw > p.bucket
      ? (p.bucket + 1) / bucketCount
      : p.bucket / bucketCount;
    const crossed = raw > p.bucket
      ? p.emaZ >= boundary + margin
      : p.emaZ <= boundary - margin;
    return crossed ? raw : p.bucket;
  }

  function updateParticles(particles, dt, time, dims, options) {
    const bucketCount = options.bucketCount;
    const margin = options.hysteresis;
    const alpha = 1 - Math.exp(-dt / options.smoothingTau);
    const events = [];

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.prevZ = p.z;
      p.x += p.vx * dt;
      if (p.x < -8) p.x = dims.width + 8;
      if (p.x > dims.width + 8) p.x = -8;

      if (p.group === 'tie') {
        // 同车道粒子共享完全相同的深度，用于检验稳定顺序。
        p.z = laneBaseZ(p.tieLane)
          + 0.12 * Math.sin(time * 0.25 + p.tieLane);
      } else {
        // 两股流深度波相位相反，形成缓慢、反复的交叉穿越；
        // 低频运动让 EMA 平滑能有效抑制桶边界抖动。
        const sign = p.group === 'A' ? 1 : -1;
        p.z = 0.5 + sign * p.zAmp
          * Math.sin(p.x * 0.004 + time * p.zSpeed + p.phase)
          + 0.05 * Math.sin(time * 2.7 + p.jitterPhase);
      }
      if (p.z < 0.001) p.z = 0.001;
      if (p.z > 0.999) p.z = 0.999;

      if (options.smoothing) p.emaZ += (p.z - p.emaZ) * alpha;
      else p.emaZ = p.z;

      p.rawBucket = bucketOf(p.emaZ, bucketCount);
      const next = options.hysteresis > 0
        ? hysteresisBucket(p, bucketCount, margin)
        : p.rawBucket;
      if (next !== p.bucket) {
        events.push({
          id: p.id,
          from: p.bucket,
          to: next,
          z: p.emaZ,
          time: time,
        });
        p.bucket = next;
        p.migratedAt = time;
      }
    }
    return events;
  }

  return {
    COLORS: COLORS,
    createParticles: createParticles,
    updateParticles: updateParticles,
    bucketOf: bucketOf,
    laneBaseZ: laneBaseZ,
  };
});
