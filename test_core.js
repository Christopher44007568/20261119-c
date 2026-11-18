// Node 冒烟测试：椭圆数学、投影、采样质量排序、预算退化
const fs = require("fs");
global.performance = { now: () => Date.now() };
global.ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
const load = (f) => (0, eval)(fs.readFileSync(f, "utf8").replace(/"use strict";/g, ""));
load("texture.js"); load("sampling.js"); load("app.js");

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS" : "FAIL") + " " + msg); if (!cond) fails++; };

// 1) 椭圆：已知 Jacobian（x 方向拉伸 8，y 方向 1）
const e1 = footprintEllipse(8, 0, 0, 1);
ok(Math.abs(e1.major - 8) < 1e-6 && Math.abs(e1.minor - 1) < 1e-6, "椭圆轴长正确");
ok(Math.abs(e1.dirX - 1) < 1e-6 && Math.abs(e1.dirY) < 1e-6, "长轴方向正确");
ok(Math.abs(e1.ratio - 8) < 1e-6, "各向异性比正确");

// 2) 投影：垂直向下足迹近圆，大倾角近地平线处足迹细长
const tex = makeTexture("checker");
const j0 = pixelJacobian(180, 120, 0, 8);
ok(footprintEllipse(j0.dudx, j0.dudy, j0.dvdx, j0.dvdy).ratio < 1.5, "垂直向下足迹近圆");
const jT = pixelJacobian(180, 60, 1.2, 8);
const eT = footprintEllipse(jT.dudx, jT.dudy, jT.dvdx, jT.dvdy);
ok(eT.ratio > 5, `大倾角远处足迹细长 (ratio=${eT.ratio.toFixed(1)})`);

// 3) 预算退化：ratio 远大于预算时 clamped 标记生效，LOD 补偿提升层号
const r5 = sampleEllipseFilter(tex, jT.u, jT.v, eT, 4, "box", true);
ok(r5.clamped && r5.usedN === 4 && r5.needN > 4, "超预算时正确退化并标记");
const r6 = sampleEllipseFilter(tex, jT.u, jT.v, eT, 4, "box", false);
ok(r5.lod > r6.lod, "LOD 补偿提升层号");

// 4) 整幅 RMSE 排序：椭圆滤波 < 各向同性 mip < 点采样
const tilt = 1.25, ts = 16;
const ref = renderView(tex, (t, u, v, e) => sampleReference(t, u, v, e), tilt, ts).img;
const imgP = renderView(tex, (t, u, v) => samplePoint(t, u, v), tilt, ts).img;
const imgI = renderView(tex, (t, u, v, e) => sampleIsoMip(t, u, v, e), tilt, ts).img;
const imgE = renderView(tex, (t, u, v, e) => sampleEllipseFilter(t, u, v, e, 16, "gauss", true).value, tilt, ts).img;
const rm = (a) => { let s = 0; for (let i = 0; i < a.data.length; i += 4) { const d = a.data[i] - ref.data[i]; s += d * d; } return Math.sqrt(s / (a.data.length / 4)) / 255; };
const [rP, rI, rE] = [rm(imgP), rm(imgI), rm(imgE)];
console.log(`  RMSE point=${(rP * 100).toFixed(2)}% iso=${(rI * 100).toFixed(2)}% ellipse=${(rE * 100).toFixed(2)}%`);
ok(rE < rI && rI < rP, "RMSE 排序: 椭圆滤波 < 各向同性 mip < 点采样");

// 5) 渲染耗时合理
const r = renderView(tex, (t, u, v, e) => sampleEllipseFilter(t, u, v, e, 16, "box", true).value, 1.1, 16);
ok(r.ms < 5000, `整幅椭圆滤波渲染 ${r.ms.toFixed(0)}ms < 5000ms`);

process.exit(fails ? 1 : 0);
