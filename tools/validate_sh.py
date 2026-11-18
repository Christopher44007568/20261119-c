#!/usr/bin/env python3
"""离线验证：环境光球谐(SH)低频光照近似的正确性。

验证项：
 1. SH 投影：常量环境只含 0 阶系数；单方向宽光斑的 1 阶向量对准光源方向。
 2. 实时旋转：用采样最小二乘构造的 SH 旋转矩阵，旋转 2*pi 后恢复原系数。
 3. 漫反射辐照度：不同阶数(L1/L2/L3)与高采样参考的 RMSE。
 4. 低频高光：Phong 瓣核的 zonal SH 卷积与参考的误差。
 5. 高频环境：报告低阶 SH 无法表达的残差能量比。
"""
import numpy as np

PI = np.pi
MAX_L = 3
N_COEF = (MAX_L + 1) ** 2  # 16

# Lambertian 卷积系数 A_l
A_LAMBERT = [PI, 2.0 * PI / 3.0, PI / 4.0, 0.0]


def fibonacci_sphere(n):
    """近似均匀球面采样，返回 (n,3)。"""
    idx = np.arange(n) + 0.5
    phi = np.arccos(1.0 - 2.0 * idx / n)
    theta = PI * (1.0 + 5.0 ** 0.5) * idx
    return np.stack([
        np.sin(phi) * np.cos(theta),
        np.sin(phi) * np.sin(theta),
        np.cos(phi),
    ], axis=1)


def sh_basis(d):
    """实数 SH 基（l<=3, 16 项），d 为 (...,3) 方向，返回 (...,16)。"""
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    out = np.stack([
        0.28209479177387814 * np.ones_like(x),
        0.4886025119029199 * y,
        0.4886025119029199 * z,
        0.4886025119029199 * x,
        1.0925484305920792 * x * y,
        1.0925484305920792 * y * z,
        0.31539156525352005 * (3.0 * z * z - 1.0),
        1.0925484305920792 * x * z,
        0.5462742152960396 * (x * x - y * y),
        0.5900435899266435 * y * (3.0 * x * x - y * y),
        2.890611442640554 * x * y * z,
        0.4570457994644658 * y * (4.0 * z * z - x * x - y * y),
        0.3731763325901154 * z * (2.0 * z * z - 3.0 * x * x - 3.0 * y * y),
        0.4570457994644658 * x * (4.0 * z * z - x * x - y * y),
        1.445305721320277 * z * (x * x - y * y),
        0.5900435899266435 * x * (x * x - 3.0 * y * y),
    ], axis=-1)
    return out


# ---------------- 环境定义（与 GLSL/JS 保持一致） ----------------

def env_constant(d):
    return np.ones(d.shape[:-1] + (3,))


SPOT_DIR = np.array([0.4, 0.6, 0.693]) / np.linalg.norm([0.4, 0.6, 0.693])
SPOT_COLOR = np.array([1.0, 0.85, 0.6])
SPOT_EXP = 6.0  # 宽光斑


def env_spot(d):
    c = np.clip(d @ SPOT_DIR, 0.0, None) ** SPOT_EXP
    return 0.05 + c[..., None] * SPOT_COLOR[None, :]


# 高频环境：多个窄小彩色光斑（低阶 SH 无法表达）
_HF_LOBES = []
_rng = np.random.default_rng(7)
for _i in range(24):
    _dir = fibonacci_sphere(24)[_i]
    _col = _rng.uniform(0.4, 1.0, 3)
    _HF_LOBES.append((_dir, _col))


def env_highfreq(d):
    out = np.full(d.shape[:-1] + (3,), 0.02)
    for direction, color in _HF_LOBES:
        c = np.clip(d @ direction, 0.0, None) ** 400.0
        out = out + c[..., None] * color[None, :] * 6.0
    return out


ENVS = {"constant": env_constant, "spot": env_spot, "highfreq": env_highfreq}

# ---------------- SH 投影 / 旋转 / 卷积 ----------------

PROJ_DIRS = fibonacci_sphere(32768)
PROJ_BASIS = sh_basis(PROJ_DIRS)
PROJ_W = 4.0 * PI / len(PROJ_DIRS)


def project(env_fn, n_coef=N_COEF):
    """数值投影：c_i = ∫ L(w) Y_i(w) dw"""
    vals = env_fn(PROJ_DIRS)  # (N,3)
    return (PROJ_BASIS[:, :n_coef].T * PROJ_W) @ vals  # (n_coef,3)


_ROT_DIRS = fibonacci_sphere(64)
_ROT_BASIS = sh_basis(_ROT_DIRS)  # (64,16)
_ROT_PINV = np.linalg.pinv(_ROT_BASIS)  # (16,64)


def rotation_matrix(rot):
    """构造 16x16 SH 旋转矩阵：c' = D c 对应 L'(w)=L(R^-1 w)。

    对带限函数（l<=3）精确：采样旋转后的基并做最小二乘还原。
    """
    basis_rot = sh_basis(_ROT_DIRS @ rot)  # Y_i(R^T w) = Y_i(R^-1 w)
    return _ROT_PINV @ basis_rot


def rot_yaw(a):
    return np.array([[np.cos(a), 0, np.sin(a)],
                     [0, 1, 0],
                     [-np.sin(a), 0, np.cos(a)]])


def rot_axis(axis, a):
    axis = np.asarray(axis, float)
    axis /= np.linalg.norm(axis)
    x, y, z = axis
    c, s = np.cos(a), np.sin(a)
    C = 1 - c
    return np.array([
        [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
        [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
        [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
    ])


def irradiance_sh(coefs, dirs, order):
    """E(n) = sum_l A_l sum_m c_lm Y_lm(n)"""
    n = (order + 1) ** 2
    scale = np.concatenate([[A_LAMBERT[l]] * (2 * l + 1) for l in range(order + 1)])
    return (sh_basis(dirs)[..., :n] * scale) @ coefs[:n]


def irradiance_ref(env_fn, dirs, n_samples=20000):
    """高采样余弦加权参考辐照度：E(n)=∫ L(w) max(n·w,0) dw，半球积分为 π。"""
    smp = fibonacci_sphere(n_samples)
    out = np.zeros(dirs.shape[:-1] + (3,))
    flat = dirs.reshape(-1, 3)
    for i, n in enumerate(flat):
        cosw = np.clip(smp @ n, 0.0, None)
        w = cosw / cosw.sum() * PI
        out.reshape(-1, 3)[i] = (env_fn(smp) * w[:, None]).sum(0)
    return out


def zonal_phong_kernel(shininess, n_coef=N_COEF, n_samples=4000):
    """归一化 Phong 瓣 cos^n 的 zonal SH 系数（每 l 的 m=0 项）。"""
    z = np.linspace(1e-6, 1.0, n_samples)
    vals = z ** shininess
    vals /= (2.0 * PI * np.trapezoid(vals, z))  # 立体角归一化
    dirs = np.zeros((n_samples, 3))
    dirs[:, 2] = z
    basis = sh_basis(dirs)[:, :n_coef]
    return 2.0 * PI * np.trapezoid(vals[:, None] * basis, z, axis=0)


def zonal_l0_index(l):
    """实数 SH 中 (l, m=0) 的系数索引。"""
    return l * l + l


def specular_sh(coefs, refl_dirs, order, shininess):
    """低频高光近似：E_spec(r) = sum_l sqrt(4pi/(2l+1)) k_l sum_m c_lm Y_lm(r)。

    lambda_l = sqrt(4pi/(2l+1)) * k_l（k_l 为核的 zonal SH 系数），
    与 Lambertian 的 A_l 记号一致（lambda_0 = pi 对应余弦核）。
    """
    k = zonal_phong_kernel(shininess)
    n = (order + 1) ** 2
    scale = np.zeros(n)
    for l in range(order + 1):
        scale[l * l:(l + 1) ** 2] = np.sqrt(4.0 * PI / (2 * l + 1)) * k[zonal_l0_index(l)]
    return (sh_basis(refl_dirs)[..., :n] * scale) @ coefs[:n]


def specular_ref(env_fn, refl_dirs, shininess, n_samples=20000):
    """参考：∫ L(w) k(w·r) dw，核 k 归一化为全球面积分 1。"""
    smp = fibonacci_sphere(n_samples)
    out = np.zeros(refl_dirs.shape[:-1] + (3,))
    flat = refl_dirs.reshape(-1, 3)
    for i, r in enumerate(flat):
        cosw = np.clip(smp @ r, 0.0, None) ** shininess
        w = cosw / cosw.sum()
        out.reshape(-1, 3)[i] = (env_fn(smp) * w[:, None]).sum(0)
    return out


# ---------------- 验证流程 ----------------

def rmse(a, b):
    return float(np.sqrt(np.mean((a - b) ** 2)))


def check_constant():
    c = project(env_constant)
    hi = np.abs(c[1:]).max()
    expect = 4.0 * PI * 0.28209479177387814  # c00 = ∫1*Y00 = sqrt(4π)
    ok = hi < 1e-5 and abs(c[0, 0] - expect) < 1e-4
    print(f"[常量环境] c00={c[0,0]:.6f} (期望 {expect:.6f}), "
          f"高阶最大|系数|={hi:.2e} -> {'PASS' if ok else 'FAIL'}")
    return ok


def check_spot_direction():
    c = project(env_spot)
    v = np.array([c[3].mean(), c[1].mean(), c[2].mean()])  # (x,y,z) 1阶向量
    v /= np.linalg.norm(v)
    cos_err = float(v @ SPOT_DIR)
    ok = cos_err > 0.999
    print(f"[宽光斑] 1阶向量与光源方向夹角 cos={cos_err:.6f} "
          f"-> {'PASS' if ok else 'FAIL'}")
    return ok


def check_rotation_restore():
    c = project(env_highfreq)
    # 单轴整周
    d_full = rotation_matrix(rot_yaw(2.0 * PI))
    err_full = np.abs(d_full @ c - c).max()
    # 复合小步进（模拟实时拖动一周）
    drift_c = c.copy()
    d_step = rotation_matrix(rot_axis([0.3, 1.0, 0.2], 2.0 * PI / 72.0))
    for _ in range(72):
        drift_c = d_step @ drift_c
    err_drift = np.abs(drift_c - c).max()
    ok = err_full < 1e-5 and err_drift < 1e-4
    print(f"[旋转复原] 整周最大偏差={err_full:.2e}, "
          f"72步复合漂移={err_drift:.2e} -> {'PASS' if ok else 'FAIL'}")
    return ok


def check_rotation_matches_reprojection():
    """旋转后的系数应与"旋转环境再投影"一致。"""
    rot = rot_axis([0.2, 0.9, 0.4], 1.1)
    c = project(env_spot)
    c_rot = rotation_matrix(rot) @ c
    c_ref = project(lambda d: env_spot(d @ rot))  # 行向量 d@R 即列向量 R^-1 d
    err = np.abs(c_rot - c_ref).max()
    ok = err < 2e-3
    print(f"[旋转正确性] 旋转系数 vs 重投影系数 最大偏差={err:.2e} "
          f"-> {'PASS' if ok else 'FAIL'}")
    return ok


def check_diffuse_orders():
    """不同阶数 SH 漫反射 vs 高采样参考。"""
    dirs = fibonacci_sphere(48)
    print("[漫反射] 各阶数与高采样(20k)参考的 RMSE / 最大误差：")
    for name in ("constant", "spot", "highfreq"):
        env_fn = ENVS[name]
        ref = irradiance_ref(env_fn, dirs)
        c = project(env_fn)
        row = f"  {name:9s}"
        for order in (1, 2, 3):
            approx = irradiance_sh(c, dirs, order)
            row += f" | L{order}: {rmse(approx, ref):.4f}/{np.abs(approx-ref).max():.4f}"
        print(row)


def check_specular():
    """低频高光近似：核越低频（n 越小）越易被低阶 SH 表达。"""
    dirs = fibonacci_sphere(48)
    for shininess in (2.0, 8.0):
        print(f"[低频高光] Phong n={shininess:.0f}，各阶数与参考的 RMSE：")
        for name in ("constant", "spot", "highfreq"):
            env_fn = ENVS[name]
            ref = specular_ref(env_fn, dirs, shininess)
            c = project(env_fn)
            row = f"  {name:9s}"
            for order in (1, 2, 3):
                approx = specular_sh(c, dirs, order, shininess)
                row += f" | L{order}: {rmse(approx, ref):.4f}"
            print(row)


def check_highfreq_residual():
    """高频环境：低阶 SH 无法表达的残差能量比（按阶数报告）。"""
    env_fn = ENVS["highfreq"]
    vals = env_fn(PROJ_DIRS)  # (N,3)
    total_e = float((vals ** 2).sum() * PROJ_W)
    c = project(env_fn)
    print("[高频残差] 低阶近似无法表达的能量占比（显式残差报告）：")
    recon_prev = np.zeros_like(vals)
    for order in (0, 1, 2, 3):
        n = (order + 1) ** 2
        recon = PROJ_BASIS[:, :n] @ c[:n]
        resid_e = float(((vals - recon) ** 2).sum() * PROJ_W)
        print(f"  L{order}: 残差能量比 = {resid_e / total_e * 100:6.2f}%  "
              f"(本阶捕获 {(float(((recon-recon_prev)**2).sum()*PROJ_W)) / total_e * 100:5.2f}%)")
        recon_prev = recon
    print("  说明：残差为高频细节（窄光斑/硬阴影边界），属低频近似的固有表达极限，")
    print("        不随旋转或采样增加而消失，需更高阶数或换用其他表示。")


def main():
    results = [
        check_constant(),
        check_spot_direction(),
        check_rotation_restore(),
        check_rotation_matches_reprojection(),
    ]
    check_diffuse_orders()
    check_specular()
    check_highfreq_residual()
    print()
    print("总体:", "全部 PASS" if all(results) else "存在 FAIL")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
