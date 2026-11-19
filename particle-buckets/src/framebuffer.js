// 软件 RGBA 帧缓冲：确定性 over 混合，便于逐像素比较分桶与全排序的色差。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PBFramebuffer = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function Framebuffer(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.background = [18, 22, 30];
  }

  Framebuffer.prototype.clear = function () {
    const px = this.pixels;
    const bg = this.background;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = bg[0];
      px[i + 1] = bg[1];
      px[i + 2] = bg[2];
      px[i + 3] = 255;
    }
  };

  // straight alpha 的 over 算子：src 叠加在 dst 之上。
  Framebuffer.prototype.composite = function (x, y, rgb, srcA) {
    const idx = (y * this.width + x) * 4;
    const px = this.pixels;
    const a = srcA;
    const inv = 1 - a;
    px[idx] = rgb[0] * a + px[idx] * inv;
    px[idx + 1] = rgb[1] * a + px[idx + 1] * inv;
    px[idx + 2] = rgb[2] * a + px[idx + 2] * inv;
  };

  // 画一个实心圆（半径小，逐像素覆盖测试即可）。
  Framebuffer.prototype.drawParticle = function (p, rgb, radius, alpha) {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(p.x - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(p.x + radius));
    const y0 = Math.max(0, Math.floor(p.y - radius));
    const y1 = Math.min(this.height - 1, Math.ceil(p.y + radius));
    for (let y = y0; y <= y1; y += 1) {
      const dy = y + 0.5 - p.y;
      for (let x = x0; x <= x1; x += 1) {
        const dx = x + 0.5 - p.x;
        if (dx * dx + dy * dy <= r2) {
          this.composite(x, y, rgb, alpha);
        }
      }
    }
  };

  function renderOrder(fb, particles, order, palette, radius, alpha, highlight) {
    fb.clear();
    for (let k = 0; k < order.length; k += 1) {
      const p = particles[order[k]];
      let rgb = palette[p.group];
      if (highlight && highlight.has(p.id)) rgb = [255, 255, 255];
      fb.drawParticle(p, rgb, radius, alpha);
    }
  }

  // 逐像素色差：RMSE、最大偏差、超阈值像素占比、平均 RGB 绝对偏差。
  function compareBuffers(ref, test) {
    const n = ref.width * ref.height;
    let sumSq = 0;
    let maxDelta = 0;
    let overThreshold = 0;
    let sumAbs = 0;
    for (let i = 0; i < n * 4; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        const d = Math.abs(ref.pixels[i + c] - test.pixels[i + c]);
        sumSq += d * d;
        sumAbs += d;
        if (d > maxDelta) maxDelta = d;
        if (d > 8) overThreshold += 1;
      }
    }
    return {
      rmse: Math.sqrt(sumSq / (n * 3)),
      maxDelta: maxDelta,
      thresholdRatio: overThreshold / (n * 3),
      meanAbs: sumAbs / (n * 3),
    };
  }

  return {
    Framebuffer: Framebuffer,
    renderOrder: renderOrder,
    compareBuffers: compareBuffers,
  };
});
