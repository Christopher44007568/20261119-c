// 浏览器主控：帧循环、Canvas 上传、HUD、桶负载、色差热图与桶数扫描。
(function () {
  'use strict';

  const W = 320;
  const H = 200;
  const SWEEP_BUCKETS = [2, 4, 8, 16, 32, 64, 128, 256];

  const el = {
    count: document.getElementById('count'),
    buckets: document.getElementById('buckets'),
    tau: document.getElementById('tau'),
    hyst: document.getElementById('hyst'),
    smoothing: document.getElementById('smoothing'),
    pause: document.getElementById('pause'),
    sweep: document.getElementById('sweep'),
    hud: document.getElementById('hud'),
    bucketNo: document.getElementById('bucketNo'),
    migrationLog: document.getElementById('migrationLog'),
    ref: document.getElementById('refCanvas'),
    test: document.getElementById('testCanvas'),
    diff: document.getElementById('diffCanvas'),
    bucketCanvas: document.getElementById('bucketCanvas'),
    sweepCanvas: document.getElementById('sweepCanvas'),
    sweepNote: document.getElementById('sweepNote'),
  };

  function readOptions() {
    return {
      count: Number(el.count.value),
      bucketCount: Number(el.buckets.value),
      smoothingTau: Number(el.tau.value),
      hysteresis: Number(el.hyst.value),
      smoothing: el.smoothing.checked,
      width: W,
      height: H,
      radius: 2.2,
      alpha: 0.32,
    };
  }

  let ctx = PBEngine.createContext(readOptions());
  let paused = false;
  let sweepRows = [];
  let sweepIdeal = [];

  const fps = { last: performance.now(), value: 0 };
  const ema = { full: 0, bucket: 0 };

  function upload(canvas, fb) {
    const c2d = canvas.getContext('2d');
    const image = c2d.createImageData(fb.width, fb.height);
    image.data.set(fb.pixels);
    c2d.putImageData(image, 0, 0);
  }

  function uploadDiff(canvas, ref, test) {
    const c2d = canvas.getContext('2d');
    const image = c2d.createImageData(ref.width, ref.height);
    for (let i = 0, j = 0; i < ref.pixels.length; i += 4, j += 4) {
      const d = Math.max(
        Math.abs(ref.pixels[i] - test.pixels[i]),
        Math.abs(ref.pixels[i + 1] - test.pixels[i + 1]),
        Math.abs(ref.pixels[i + 2] - test.pixels[i + 2])
      );
      // 无色差 -> 黑；色差越大越红，放大 4 倍便于观察。
      image.data[j] = Math.min(255, d * 4);
      image.data[j + 1] = Math.min(255, d * 0.6);
      image.data[j + 2] = Math.min(255, d * 0.6);
      image.data[j + 3] = 255;
    }
    c2d.putImageData(image, 0, 0);
  }

  function drawBucketHistogram(counts) {
    const c = el.bucketCanvas;
    const c2d = c.getContext('2d');
    c2d.clearRect(0, 0, c.width, c.height);
    const max = Math.max(1, Math.max.apply(null, counts));
    const barW = c.width / counts.length;
    for (let b = 0; b < counts.length; b += 1) {
      const h = counts[b] / max * (c.height - 18);
      c2d.fillStyle = '#6db3ff';
      c2d.fillRect(b * barW + 1, c.height - h - 14,
        Math.max(1, barW - 2), h);
      if (counts.length <= 32 || b % Math.ceil(counts.length / 16) === 0) {
        c2d.fillStyle = '#93a1b2';
        c2d.font = '9px monospace';
        c2d.fillText(String(b), b * barW + 1, c.height - 3);
      }
    }
    c2d.fillStyle = '#e6ecf3';
    c2d.font = '10px monospace';
    c2d.fillText('峰值桶 ' + max + ' 粒子 · 均值 ' +
      (counts.reduce(function (a, b2) { return a + b2; }, 0) / counts.length)
        .toFixed(1), 6, 12);
  }

  function drawSweep() {
    const c = el.sweepCanvas;
    const c2d = c.getContext('2d');
    c2d.clearRect(0, 0, c.width, c.height);
    if (!sweepRows.length) return;
    const padL = 44;
    const padB = 26;
    const plotW = c.width - padL - 12;
    const plotH = c.height - padB - 28;
    const maxRmse = Math.max.apply(null,
      sweepRows.map(function (r) { return r.diff.rmse; })) || 1;
    const maxInv = Math.max.apply(null,
      sweepRows.map(function (r) { return r.inversions; })) || 1;

    c2d.strokeStyle = '#26303d';
    c2d.beginPath();
    c2d.moveTo(padL, 8);
    c2d.lineTo(padL, 8 + plotH);
    c2d.lineTo(padL + plotW, 8 + plotH);
    c2d.stroke();

    function x(i) {
      return padL + plotW * (i / (sweepRows.length - 1));
    }
    function y(v) {
      return 8 + plotH * (1 - v / maxRmse);
    }

    function line(color, picker) {
      c2d.strokeStyle = color;
      c2d.fillStyle = color;
      c2d.beginPath();
      sweepRows.forEach(function (r, i) {
        const px = x(i);
        const py = y(picker(r));
        if (i === 0) c2d.moveTo(px, py);
        else c2d.lineTo(px, py);
      });
      c2d.stroke();
    }
    line('#ff8095', function (r) { return r.diff.rmse; });
    line('#ffd166', function (r) {
      return maxRmse * (r.inversions / maxInv);
    });
    c2d.fillStyle = '#ff8095';
    c2d.beginPath();
    sweepRows.forEach(function (r, i) {
      const px = x(i);
      const py = y(r.diff.rmse);
      c2d.moveTo(px + 3, py);
      c2d.arc(px, py, 3, 0, Math.PI * 2);
    });
    c2d.fill();
    sweepRows.forEach(function (r, i) {
      c2d.fillStyle = '#93a1b2';
      c2d.font = '9px monospace';
      c2d.fillText(String(r.buckets), x(i) - 8, c.height - 8);
      c2d.fillStyle = '#ff8095';
      c2d.fillText(r.diff.rmse.toFixed(1), x(i) - 8, y(r.diff.rmse) - 6);
    });
    c2d.font = '10px monospace';
    c2d.fillStyle = '#ff8095';
    c2d.fillText('● 稳定分桶 RMSE', padL, 12);
    c2d.fillStyle = '#ffd166';
    c2d.fillText('● 深度逆序对（归一化）', padL + 150, 12);
    c2d.fillStyle = '#7ee0a8';
    const idealMax = Math.max.apply(null,
      sweepIdeal.map(function (r) { return r.diff.rmse; }));
    c2d.fillText('桶内理想重排 RMSE 峰值=' +
      (idealMax || 0).toFixed(2) + '（误差下界）', padL + 330, 12);
    c2d.fillStyle = '#93a1b2';
    c2d.fillText('RMSE', 6, 14);
  }

  function updateHud(r, opt) {
    const d = r.diff;
    const rows = [
      ['FPS', fps.value.toFixed(1)],
      ['全排序耗时(ms)', ema.full.toFixed(3)],
      ['分桶排序耗时(ms)', ema.bucket.toFixed(3)],
      ['加速比', (ema.full / Math.max(1e-6, ema.bucket)).toFixed(1) + '×'],
      ['颜色 RMSE（0-255）', d.rmse.toFixed(3)],
      ['平均绝对色差', d.meanAbs.toFixed(3)],
      ['最大像素偏差', d.maxDelta.toFixed(0)],
      ['偏差>8 通道占比', (d.thresholdRatio * 100).toFixed(2) + '%'],
      ['深度逆序粒子对', String(r.inversions)],
      ['同深度次序失配', String(r.tieMismatches)],
      ['本帧跨桶迁移', String(r.migrationCount)],
      ['当前桶数 / 粒子数', opt.bucketCount + ' / ' + opt.count],
    ];
    el.hud.innerHTML = rows.map(function (pair) {
      return '<tr><td>' + pair[0] + '</td><td>' + pair[1] + '</td></tr>';
    }).join('');
    el.bucketNo.textContent = opt.bucketCount;
  }

  function updateMigrationLog(events, time) {
    const lines = ctx.recentMigrations.slice(-14).reverse().map(function (e) {
      return '<div>t=' + e.time.toFixed(2) + 's 粒子#' + e.id +
        ' 桶 ' + e.from + ' → ' + e.to + '（z=' + e.z.toFixed(3) + '）</div>';
    });
    el.migrationLog.innerHTML = lines.join('') ||
      '<div>（暂无迁移，深度均稳定在桶内）</div>';
  }

  function runSweep() {
    sweepRows = PBEngine.sweepBucketCounts(ctx, SWEEP_BUCKETS);
    sweepIdeal = PBEngine.sweepBucketCounts(ctx, SWEEP_BUCKETS, 'id');
    drawSweep();
    const worst = sweepRows[0];
    const fine = sweepRows[sweepRows.length - 1];
    el.sweepNote.textContent =
      '同一帧状态按真实深度重放（实际策略=桶内稳定序）：' + worst.buckets + ' 桶 RMSE=' +
      worst.diff.rmse.toFixed(2) + '、逆序对 ' + worst.inversions +
      '；' + fine.buckets + ' 桶 RMSE=' + fine.diff.rmse.toFixed(2) +
      '、逆序对 ' + fine.inversions +
      '。桶越细越接近全排序的透明混合结果；若桶内逐帧重排（绿线对照）则色差趋近 0，' +
      '但会失去同深度粒子的稳定顺序并重新引入每帧排序成本。';
  }

  let sweepIn = 240;
  function frame(nowMs) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (nowMs - fps.last) / 1000 || 1 / 60);
    fps.last = nowMs;
    if (paused) return;

    const opt = readOptions();
    const r = PBEngine.stepFrame(ctx, dt);
    ema.full += (r.fullSortMs - ema.full) * 0.1;
    ema.bucket += (r.bucketSortMs - ema.bucket) * 0.1;

    const instant = 1 / Math.max(1e-6, dt);
    fps.value = fps.value === 0 ? instant : fps.value * 0.95 + instant * 0.05;

    upload(el.ref, ctx.refFb);
    upload(el.test, ctx.testFb);
    uploadDiff(el.diff, ctx.refFb, ctx.testFb);
    drawBucketHistogram(r.counts);
    updateHud(r, opt);
    updateMigrationLog(r.events, ctx.time);

    sweepIn -= 1;
    if (sweepIn <= 0) {
      runSweep();
      sweepIn = 300;
    }
  }

  function resetContext() {
    ctx = PBEngine.createContext(readOptions());
    sweepIn = 1;
  }

  el.count.addEventListener('input', function () {
    document.getElementById('countVal').textContent = el.count.value;
    resetContext();
  });
  el.buckets.addEventListener('input', function () {
    document.getElementById('bucketsVal').textContent = el.buckets.value;
    ctx.options.bucketCount = Number(el.buckets.value);
    ctx.particles.forEach(function (p) { p.bucket = -1; });
    sweepIn = 1;
  });
  el.tau.addEventListener('input', function () {
    document.getElementById('tauVal').textContent =
      Number(el.tau.value).toFixed(2);
    ctx.options.smoothingTau = Number(el.tau.value);
  });
  el.hyst.addEventListener('input', function () {
    document.getElementById('hystVal').textContent =
      Number(el.hyst.value).toFixed(3);
    ctx.options.hysteresis = Number(el.hyst.value);
  });
  el.smoothing.addEventListener('change', function () {
    ctx.options.smoothing = el.smoothing.checked;
  });
  el.pause.addEventListener('click', function () {
    paused = !paused;
    el.pause.textContent = paused ? '继续' : '暂停';
  });
  el.sweep.addEventListener('click', runSweep);

  requestAnimationFrame(function (t) {
    fps.last = t;
    frame(t);
  });
})();
