// 引擎层：把模拟、排序、软件渲染串成单帧流水线，并提供多桶数扫描。
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./simulation.js') : root.PBSim,
    typeof require === 'function' ? require('./sort.js') : root.PBSort,
    typeof require === 'function' ? require('./framebuffer.js') : root.PBFramebuffer
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PBEngine = api;
})(typeof self !== 'undefined' ? self : globalThis, function (Sim, Sort, FB) {
  'use strict';

  function now() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  function createContext(options) {
    const particles = Sim.createParticles(options.count, options.width, options.height);
    const palette = { A: Sim.COLORS.streamA, B: Sim.COLORS.streamB, tie: Sim.COLORS.tie };
    return {
      particles: particles,
      palette: palette,
      time: 0,
      frame: 0,
      options: options,
      refFb: new FB.Framebuffer(options.width, options.height),
      testFb: new FB.Framebuffer(options.width, options.height),
      recentMigrations: [],
    };
  }

  // 校验同深度粒子在两种排序中的相对次序完全一致。
  function checkTieOrder(particles, refOrder, testOrder) {
    const refTies = new Map();
    const testTies = new Map();
    function collect(order, map) {
      for (let k = 0; k < order.length; k += 1) {
        const p = particles[order[k]];
        if (p.group !== 'tie') continue;
        if (!map.has(p.tieLane)) map.set(p.tieLane, []);
        map.get(p.tieLane).push(p.id);
      }
    }
    collect(refOrder, refTies);
    collect(testOrder, testTies);
    let mismatches = 0;
    refTies.forEach(function (ids, lane) {
      const other = testTies.get(lane) || [];
      if (ids.length !== other.length) {
        mismatches += 1;
        return;
      }
      for (let i = 0; i < ids.length; i += 1) {
        if (ids[i] !== other[i]) mismatches += 1;
      }
    });
    return mismatches;
  }

  // 推进一帧并产出参照帧、分桶帧、色差、迁移与桶负载。
  function stepFrame(ctx, dt) {
    const opt = ctx.options;
    ctx.time += dt;
    ctx.frame += 1;

    const events = Sim.updateParticles(
      ctx.particles, dt, ctx.time,
      { width: opt.width, height: opt.height }, opt
    );
    ctx.recentMigrations.push.apply(ctx.recentMigrations, events);
    while (ctx.recentMigrations.length > 200) ctx.recentMigrations.shift();

    const t0 = now();
    const refOrder = Sort.fullSortOrder(ctx.particles);
    const t1 = now();
    const bucketed = Sort.bucketSortOrder(ctx.particles, opt.bucketCount);
    const t2 = now();

    FB.renderOrder(ctx.refFb, ctx.particles, refOrder, ctx.palette,
      opt.radius, opt.alpha, null);
    const highlight = new Set(events.map(function (e) { return e.id; }));
    FB.renderOrder(ctx.testFb, ctx.particles, bucketed.order, ctx.palette,
      opt.radius, opt.alpha, highlight);

    const diff = FB.compareBuffers(ctx.refFb, ctx.testFb);
    return {
      frame: ctx.frame,
      time: ctx.time,
      events: events,
      migrationCount: events.length,
      counts: bucketed.counts,
      offsets: bucketed.offsets,
      refOrder: refOrder,
      testOrder: bucketed.order,
      diff: diff,
      inversions: Sort.countInversions(ctx.particles, bucketed.order),
      tieMismatches: checkTieOrder(ctx.particles, refOrder, bucketed.order),
      fullSortMs: t1 - t0,
      bucketSortMs: t2 - t1,
    };
  }

  // 对同一批粒子状态重放多个桶数（用独立桶状态副本），输出色差对比。
  // withinBucket:
  //   'stable'（默认）= 真实分桶策略，桶内保持稳定顺序，体现量化色差；
  //   'id' = 桶内按全排序规则重排，作为同桶数下的误差下界对照。
  function sweepBucketCounts(ctx, bucketCounts, withinBucket) {
    const particles = ctx.particles;
    const opt = ctx.options;
    const refOrder = Sort.fullSortOrder(particles);
    const refFb = new FB.Framebuffer(opt.width, opt.height);
    FB.renderOrder(refFb, particles, refOrder, ctx.palette,
      opt.radius, opt.alpha, null);

    const liveBuckets = particles.map(function (p) { return p.bucket; });
    const rows = bucketCounts.map(function (b) {
      particles.forEach(function (p) {
        p.bucket = Sim.bucketOf(p.z, b);
      });
      const bucketed = Sort.bucketSortOrder(particles, b,
        { withinBucket: withinBucket || 'stable' });
      const testFb = new FB.Framebuffer(opt.width, opt.height);
      FB.renderOrder(testFb, particles, bucketed.order, ctx.palette,
        opt.radius, opt.alpha, null);
      return {
        buckets: b,
        diff: FB.compareBuffers(refFb, testFb),
        inversions: Sort.countInversions(particles, bucketed.order),
        counts: bucketed.counts,
      };
    });
    // 恢复实时流水线的迟滞桶归属，扫描不污染下一帧渲染。
    particles.forEach(function (p, i) { p.bucket = liveBuckets[i]; });
    return rows;
  }

  return {
    createContext: createContext,
    stepFrame: stepFrame,
    sweepBucketCounts: sweepBucketCounts,
    checkTieOrder: checkTieOrder,
  };
});
