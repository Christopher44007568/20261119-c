# Clearcoat PBR（双层高光模型）

## 模型结构

- **底层**（`baseColor` / `metallic` / `roughness`）：标准 metallic-roughness
  GGX，控制漫反射与金属度。
- **清漆层**（`clearcoat` / `clearcoatRoughness` / `clearcoatIOR` /
  `clearcoatThickness`）：介电 GGX 高光瓣，F0 由折射率精确推出
  `((ior-1)/(ior+1))^2`，厚度通过 Beer-Lambert 吸收对底层轻微染色。

两层高光同时可见：清漆只按 Fresnel 份额 `Fc = clearcoat * F_coat(NoH)`
分走能量，**不会覆盖底层颜色**——到达底层的光乘以
`(1 - Fc)^2 * absorption`（进出各穿越一次界面），吸收项也按权重
`mix(1, absorption, clearcoat)` 门控，因此 `clearcoat = 0` 时精确退回
原始底层 BRDF。

## 能量守恒

两份高光从不以全量叠加：清漆反射掉的 Fresnel 份额会从底层能量中扣除。
`ClearcoatTerms` 记录每一层的反射项（`coatFresnel`、`layerAttenuation`、
`absorption`、`baseThroughCoat`、`total`），便于审查能量分配。

## 文件

- `shaders/clearcoat_pbr.glsl` — GLSL 实现（include 形式），入口
  `cc_evaluate(material, N, V, L, out terms)`。
- `tools/energy_check.py` — 纯 Python（无依赖）镜像同一数学模型，用分层
  Monte Carlo 积分方向-半球反射率 `R(wo)`，验证：
  1. 单一底层、2. 仅清漆反射、3. 组合结果三种场景下 `R(wo) <= 1`；
  4. 组合结果低于两份全量直接相加（不重复叠能），且组合中的底层部分
     相对独立底层被正确衰减；
  5. 清漆权重归零时与原始底层逐点相等（误差为 0）；
  6. 打印采样方向上的全部多层反射项。

运行：

```sh
python3 tools/energy_check.py
```
