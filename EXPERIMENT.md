# 可重复的半色调印刷分色实验

把输入的**线性 sRGB** 图像按显式规则转换为 CMYK 四色版，用调幅（AM）
旋转网屏生成网点，模拟纸张反射、网点扩大、光学扩散与套印偏移，并量化
面积覆盖、细节损失与指定区域的平均颜色误差。

## 运行

```bash
# 依赖在用户 site-packages 中时需要显式指定 PYTHONPATH
export PYTHONPATH=/home/hj/.local/lib/python3.14/site-packages

python3 run_experiment.py                       # 默认 300/600 dpi
python3 run_experiment.py --dpi 150 300 600     # 三档分辨率
python3 run_experiment.py --output-dir artifacts/results
```

固定随机种子（默认 `20261119`），相同参数重跑输出**逐字节一致**
（已用 sha256 校验）。

## 明确的转换与模拟规则

1. **纸张白归一化**：先除以纸张反射率，使空白纸面映射为零油墨。
2. **线性 RGB → CMYK**（`halftone/color.py`）：
   - 补色：`C0=1-R, M0=1-G, Y0=1-B`
   - 中性分量：`n=min(C0,M0,Y0)`
   - 黑版（UCR）：`K=ucr_strength*n`（默认 0.9），`C/M/Y` 各自减去 `K`
3. **网点扩大 TVI**：覆盖率域抛物线 `gain=4g*c*(1-c)`，50% 中间调
   增加 12 个百分点；作用在覆盖率上，因此与输出 DPI 无关。
4. **AM 网屏**：旋转坐标系上的周期 spot 函数，按取值分位数阈值化，
   从构造上保证网点面积等于请求覆盖率（`halftone/screen.py`）。
   - 网角/网频/点形按版独立配置（见 `halftone/config.py`）
   - 点形：`circle`、`euclidean`、`diamond`、`line`
5. **套印偏移**：各版按物理微米量平移，运行时换算为当前 DPI 的像素。
6. **印刷模型**：油墨按 Beer-Lambert 密度叠加，Demichel 权重混合 16 个
   Neugebauer 基色，得到纸张反射率（线性 RGB）。
7. **纸张颗粒**：固定种子的乘性噪声。

## 分辨率独立性

物理尺寸（90 × 120 mm）与物理网频（lpi）固定，改变 DPI 只改变采样网格。
例如 C 版 150 lpi 在 150/300/600 dpi 下节距均为 0.1693 mm。

## 输出

每个 `results/run_<dpi>dpi/` 目录：

- `plate_C/M/Y/K.tif`：**1-bit Group4 TIFF**，0=油墨、1=纸面，
  带 DPI 标签与物理尺寸；另附灰度预览 PNG
- `composite_render.png`：四版合成的印刷反射图（gamma sRGB 预览）
- `zoom_views.png`：四色版 + 合成 + 原稿的 8 mm 放大对照
- `metrics.png`：覆盖率、细线 FWHM、区域色差三联图
- `ramp_coverage.csv`：灰阶每级的请求/实测覆盖率与误差（百分点）
- `line_detail.csv`：细线目标/渲染 FWHM、比值、Michelson 对比度
- `wedge_contrast.csv`：分辨率楔形各窗口对比度
- `color_error.csv`：ROI 平均与像素级 ΔE2000/ΔE76/RGB 误差
- `report.json`：完整配置、汇总指标与明细

## 实测结论（150 / 300 / 600 dpi）

| DPI | 覆盖率 RMSE(C, 百分点) | 区域平均总ΔE00 | 工艺ΔE00 | 色域限制ΔE00 |
| --- | --- | --- | --- | --- |
| 150 | 0.127 | 6.75 | 0.68 | 6.59 |
| 300 | 0.071 | 6.70 | 0.25 | 6.59 |
| 600 | 0.044 | 6.65 | 0.20 | 6.59 |

- **覆盖率**：分位数阈值化使面积误差随 DPI 单调下降，600 dpi 时 < 0.05 百分点。
- **颜色误差**：区域平均总误差约 6.7 ΔE2000，其中绝大部分（6.59）来自油墨
  色域与中性纸白的固有限制，与分辨率无关；加网/套印引入的**工艺误差**
  从 0.68（150 dpi）降到 0.20（600 dpi）。
- **细节损失**：150 dpi 时 0.18 mm 及更细线条 FWHM 归零（细节丢失）；
  600 dpi 时全部细线 FWHM 比值 ≈ 1.0，对比度保持约 0.82。
- **逐像素 ΔE** 仍较大（约 24），这是 AM 网点本身的高频空间波动，属预期；
  观测印刷品应使用区域平均颜色，故主指标采用 ROI 空间平均。

## 代码结构

| 文件 | 职责 |
| --- | --- |
| `halftone/config.py` | 全部物理参数：尺寸、网屏、油墨、纸张、偏移 |
| `halftone/color.py` | RGB→CMYK 规则、XYZ/Lab、CIEDE2000、Neugebauer |
| `halftone/screen.py` | 旋转网屏、四种点形、分位数阈值、TVI 曲线 |
| `halftone/target.py` | 测试靶：灰阶、渐变、细线、楔形、色块与 ROI |
| `halftone/simulate.py` | 网点扩大、加网、套印、光学扩散、合成 |
| `halftone/metrics.py` | 覆盖率、FWHM/对比度、区域与像素级色差 |
| `halftone/export.py` | 1-bit TIFF、预览、放大视图与图表导出 |
| `run_experiment.py` | 命令行入口、多 DPI 运行与报告生成 |
| `tests/test_pipeline.py` | 规则与几何不变量的快速自检 |
