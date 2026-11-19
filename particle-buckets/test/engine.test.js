const assert = require('node:assert/strict');
const Sim = require('../src/simulation.js');
const Sort = require('../src/sort.js');
const FB = require('../src/framebuffer.js');
const Engine = require('../src/engine.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('  ok - ' + name);
}

function makeParticle(id, z, extra) {
  return Object.assign({
    id: id, group: 'A', x: 50, y: 50, z: z, emaZ: z,
    prevZ: z, vx: 0, phase: 0, zAmp: 0.3, zSpeed: 0.7,
    bucket: -1, rawBucket: -1, migratedAt: -1, tieLane: -1,
  }, extra || {});
}

test('fullSortOrder 按 z 降序、平局按 id 升序', function () {
  const ps = [makeParticle(0, 0.2), makeParticle(1, 0.9),
    makeParticle(2, 0.5), makeParticle(3, 0.5)];
  assert.deepEqual(Sort.fullSortOrder(ps), [1, 2, 3, 0]);
});

test('bucketSortOrder 桶间降序且桶内保持稳定顺序', function () {
  const ps = [
    makeParticle(0, 0.9, { bucket: 1 }),
    makeParticle(1, 0.1, { bucket: 0 }),
    makeParticle(2, 0.8, { bucket: 1 }),
  ];
  const r = Sort.bucketSortOrder(ps, 2);
  assert.deepEqual(r.order, [0, 2, 1]);
  assert.deepEqual(r.counts, [1, 2]);
});

test('全排序逆序对为 0，分桶排序逆序对非负', function () {
  const ps = [];
  for (let i = 0; i < 200; i += 1) {
    const z = ((i * 37) % 101) / 101;
    ps.push(makeParticle(i, z, { bucket: Sim.bucketOf(z, 8) }));
  }
  const full = Sort.fullSortOrder(ps);
  assert.equal(Sort.countInversions(ps, full), 0);
  const b = Sort.bucketSortOrder(ps, 8);
  assert.ok(Sort.countInversions(ps, b.order) >= 0);
});

test('等深粒子不计入逆序对', function () {
  const ps = [makeParticle(0, 0.5), makeParticle(1, 0.5),
    makeParticle(2, 0.5)];
  assert.equal(Sort.countInversions(ps, [2, 1, 0]), 0);
});

test('updateParticles 产出迁移事件且原始分桶始终在范围内', function () {
  const ps = Sim.createParticles(500, 320, 200);
  const opt = { bucketCount: 16, hysteresis: 0.01, smoothingTau: 0.12,
    smoothing: true };
  let migrations = 0;
  for (let f = 0; f < 120; f += 1) {
    const events = Sim.updateParticles(ps, 1 / 60, f / 60,
      { width: 320, height: 200 }, opt);
    migrations += events.length;
    ps.forEach(function (p) {
      assert.ok(p.rawBucket >= 0 && p.rawBucket < 16);
      assert.ok(p.bucket >= 0 && p.bucket < 16);
    });
  }
  assert.ok(migrations > 0, '动态场景应当出现跨桶迁移');
});

test('迟滞减少桶边界附近的迁移次数', function () {
  function seeded() {
    let seed = 1234567;
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  function run(hysteresis) {
    const ps = Sim.createParticles(800, 320, 200, seeded());
    const opt = { bucketCount: 12, hysteresis: hysteresis,
      smoothingTau: 0.12, smoothing: true };
    let migrations = 0;
    for (let f = 0; f < 180; f += 1) {
      migrations += Sim.updateParticles(ps, 1 / 60, f / 60,
        { width: 320, height: 200 }, opt).length;
    }
    return migrations;
  }
  const withH = run(0.02);
  const noH = run(0);
  assert.ok(withH <= noH, '迟滞迁移 ' + withH + ' 应 <= 无迟滞 ' + noH);
});

test('受控抖动：迟滞死区完全吸收小于 margin 的边界抖动', function () {
  // 粒子静止在桶中心附近，只叠加幅度 0.05 的高频抖动。
  function migrations(hysteresis) {
    const B = 16;
    const ps = [];
    for (let i = 0; i < 2000; i += 1) {
      const base = ((i % B) + 0.5) / B;
      const z = Math.max(0.001, Math.min(0.999, base));
      ps.push({ id: i, jitterPhase: i * 0.37, z: z, emaZ: z,
        bucket: Sim.bucketOf(z, B) });
    }
    let mig = 0;
    for (let f = 0; f < 300; f += 1) {
      const t = f / 60;
      for (const p of ps) {
        const base = ((p.id % B) + 0.5) / B;
        p.emaZ = Math.max(0.001, Math.min(0.999,
          base + 0.05 * Math.sin(t * 2.7 + p.jitterPhase)));
        const raw = Sim.bucketOf(p.emaZ, B);
        let next = raw;
        if (hysteresis > 0 && raw !== p.bucket) {
          const boundary = raw > p.bucket
            ? (p.bucket + 1) / B : p.bucket / B;
          const crossed = raw > p.bucket
            ? p.emaZ >= boundary + hysteresis
            : p.emaZ <= boundary - hysteresis;
          next = crossed ? raw : p.bucket;
        }
        if (next !== p.bucket) {
          mig += 1;
          p.bucket = next;
        }
      }
    }
    return mig;
  }
  assert.ok(migrations(0) > 0, '无迟滞时抖动应产生迁移');
  assert.equal(migrations(0.06), 0, 'margin 大于抖动幅度时迁移应为 0');
});

test('同深度车道存在且 checkTieOrder 在分桶输出中保持一致', function () {
  const opt = { count: 1200, width: 160, height: 100, bucketCount: 16,
    hysteresis: 0.01, smoothingTau: 0.12, smoothing: true,
    radius: 2, alpha: 0.35 };
  const ctx = Engine.createContext(opt);
  const tieParticles = ctx.particles.filter(function (p) {
    return p.group === 'tie';
  });
  assert.ok(tieParticles.length >= 20);
  for (let f = 0; f < 30; f += 1) {
    const r = Engine.stepFrame(ctx, 1 / 60);
    assert.equal(r.tieMismatches, 0);
  }
});

test('全排序与自身色差为 0，分桶色差非负', function () {
  const fb1 = new FB.Framebuffer(40, 30);
  const fb2 = new FB.Framebuffer(40, 30);
  const ps = [makeParticle(0, 0.8, { x: 10, y: 10 }),
    makeParticle(1, 0.2, { x: 12, y: 12 })];
  FB.renderOrder(fb1, ps, [0, 1], { A: [255, 0, 0] }, 4, 0.5, null);
  FB.renderOrder(fb2, ps, [0, 1], { A: [255, 0, 0] }, 4, 0.5, null);
  assert.equal(FB.compareBuffers(fb1, fb2).rmse, 0);
  const fb3 = new FB.Framebuffer(40, 30);
  FB.renderOrder(fb3, ps, [1, 0], { A: [255, 0, 0] }, 4, 0.5, null);
  assert.ok(FB.compareBuffers(fb1, fb3).rmse >= 0);
});

test('桶数扫描：稳定序色差随桶数下降；理想桶内排序超细桶等价全排序', function () {
  const opt = { count: 1500, width: 160, height: 100, bucketCount: 8,
    hysteresis: 0, smoothingTau: 0.12, smoothing: false,
    radius: 2, alpha: 0.35 };
  const ctx = Engine.createContext(opt);
  for (let f = 0; f < 24; f += 1) Engine.stepFrame(ctx, 1 / 60);
  const rows = Engine.sweepBucketCounts(ctx, [4, 8, 16, 64, 256], 'stable');
  assert.equal(rows[0].buckets, 4);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i].diff.rmse <= rows[i - 1].diff.rmse + 1e-9,
      'RMSE 应随桶数单调不增');
  }
  assert.ok(rows[0].diff.rmse > 0, '粗桶应产生可测色差');

  const ideal = Engine.sweepBucketCounts(ctx, [1000000], 'id');
  assert.equal(ideal[0].inversions, 0);
  assert.equal(ideal[0].diff.rmse, 0);
});

test('桶数扫描不污染实时迟滞桶归属', function () {
  const opt = { count: 800, width: 160, height: 100, bucketCount: 12,
    hysteresis: 0.02, smoothingTau: 0.12, smoothing: true,
    radius: 2, alpha: 0.35 };
  const ctx = Engine.createContext(opt);
  for (let f = 0; f < 30; f += 1) Engine.stepFrame(ctx, 1 / 60);
  const before = ctx.particles.map(function (p) { return p.bucket; });
  Engine.sweepBucketCounts(ctx, [2, 16, 128]);
  const after = ctx.particles.map(function (p) { return p.bucket; });
  assert.deepEqual(after, before);
});

console.log('\n' + passed + ' tests passed');
