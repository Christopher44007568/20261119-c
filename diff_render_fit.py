"""Differentiable rendering parameter fitting demo (pure NumPy)."""

import json
import os

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT_DIR = "artifacts"
os.makedirs(OUT_DIR, exist_ok=True)

# ----------------------------- fixed scene config -----------------------------
H = W = 96
FOCAL = 120.0
BG = np.array([0.10, 0.10, 0.12])          # background color (fixed)
LIGHT_DIR = np.array([0.5, 0.6, -0.62])    # direction toward light (fixed)
LIGHT_DIR = LIGHT_DIR / np.linalg.norm(LIGHT_DIR)
AMBIENT = 0.15                             # ambient term (fixed)
SCALES = np.array([1.0, 0.65, 1.35])       # ellipsoid geometry (fixed)
INV_S2 = 1.0 / SCALES**2
TAU = 0.05                                 # soft-silhouette sigmoid temperature


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.clip(x, -60.0, 60.0)))

# Ground truth: only for target synthesis and final evaluation, never for init.
GT = {
    "rot": np.array([0.5, -0.7, 0.3]),
    "trans": np.array([0.4, -0.2, 6.0]),
    "albedo": np.array([0.85, 0.45, 0.30]),
}

# Occluder (fixed, not optimized): sphere between object and camera.
OCCLUDER = {
    "scales": np.array([0.8, 0.8, 0.8]),
    "trans": np.array([0.9, 0.35, 4.6]),
    "albedo": np.array([0.50, 0.50, 0.55]),
}


# ----------------------------- rotation matrices -----------------------------
def rot_mats(a, b, c):
    """R = Rz(c) @ Ry(b) @ Rx(a); also returns dR/d(angle) list."""
    ca, sa = np.cos(a), np.sin(a)
    cb, sb = np.cos(b), np.sin(b)
    cc, sc = np.cos(c), np.sin(c)
    Rx = np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]])
    Ry = np.array([[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]])
    Rz = np.array([[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]])
    dRx = np.array([[0, 0, 0], [0, -sa, -ca], [0, ca, -sa]])
    dRy = np.array([[-sb, 0, cb], [0, 0, 0], [-cb, 0, -sb]])
    dRz = np.array([[-sc, -cc, 0], [cc, -sc, 0], [0, 0, 0]])
    R = Rz @ Ry @ Rx
    dR = [Rz @ Ry @ dRx, Rz @ dRy @ Rx, dRz @ Ry @ Rx]
    return R, dR


def pixel_rays():
    """(P,3) unit ray directions; camera at origin looking along +z."""
    us = np.arange(W)
    vs = np.arange(H)
    uu, vv = np.meshgrid(us, vs)
    x = (uu - (W - 1) / 2.0) / FOCAL
    y = (vv - (H - 1) / 2.0) / FOCAL
    d = np.stack([x, y, np.ones_like(x)], axis=-1).reshape(-1, 3)
    return d / np.linalg.norm(d, axis=1, keepdims=True)


RAYS = pixel_rays()
NPIX = RAYS.shape[0]


# ----------------------------- forward renderer -----------------------------
def intersect_ellipsoid(o_l, d_l, inv_s2):
    """Ray (origin o_l, dir d_l) vs ellipsoid in local frame.

    Returns quadratic coefficients A, B, C, discriminant Delta,
    q = Delta/(4A), near-root lambda, and hit mask.
    """
    A = np.sum(d_l * d_l * inv_s2, axis=1)
    B = 2.0 * np.sum(o_l * d_l * inv_s2, axis=1)
    C = np.sum(o_l * o_l * inv_s2, axis=1) - 1.0
    Delta = B * B - 4.0 * A * C
    q = Delta / (4.0 * A)
    hit = Delta > 1e-12
    lam = np.full_like(Delta, np.inf)
    sq = np.sqrt(np.maximum(Delta, 0.0))
    lam[hit] = (-B[hit] - sq[hit]) / (2.0 * A[hit])
    return A, B, C, Delta, q, lam, hit


def shade(o_l, d_l, lam, R, inv_s2, albedo):
    """Hit-point normal + Lambert shading; returns (P,3) color and normals."""
    p_l = o_l + lam[:, None] * d_l
    m = p_l * inv_s2
    n_l = m / np.linalg.norm(m, axis=1, keepdims=True)
    n = n_l @ R.T  # row-vector form of R @ n_l
    ndotl = np.maximum(0.0, n @ LIGHT_DIR)
    h = AMBIENT + (1.0 - AMBIENT) * ndotl
    return albedo[None, :] * h[:, None], n_l, n


def render(rot, trans, albedo, occluder=None):
    """Render the full image, returns (H,W,3). Occluder is a fixed scene part."""
    R, _ = rot_mats(*rot)
    o_l = np.broadcast_to(-R.T @ trans, RAYS.shape).copy()
    d_l = RAYS @ R  # row-vector form of R.T @ d
    _, _, _, _, q, lam_obj, _ = intersect_ellipsoid(o_l, d_l, INV_S2)
    alpha = sigmoid(q / TAU)
    lam_safe = np.where(np.isfinite(lam_obj), lam_obj, 0.0)
    color_obj, _, _ = shade(o_l, d_l, lam_safe, R, INV_S2, albedo)
    bg_eff = np.broadcast_to(BG, (NPIX, 3)).copy()
    fixed = np.zeros((NPIX, 3))
    trans_occ = np.ones(NPIX)

    if occluder is not None:
        inv_s2o = 1.0 / occluder["scales"] ** 2
        o_lo = np.broadcast_to(-occluder["trans"], RAYS.shape)
        _, _, _, _, q_o, lam_o, _ = intersect_ellipsoid(o_lo, RAYS, inv_s2o)
        alpha_o = sigmoid(q_o / TAU)
        lam_o_safe = np.where(np.isfinite(lam_o), lam_o, 0.0)
        color_o, _, _ = shade(o_lo, RAYS, lam_o_safe, np.eye(3), inv_s2o,
                              occluder["albedo"])
        occ_in_front = lam_o < lam_obj
        K = alpha_o[:, None] * color_o + (1.0 - alpha_o)[:, None] * BG[None, :]
        bg_eff = np.where(occ_in_front[:, None], BG[None, :], K)
        fixed = np.where(occ_in_front[:, None],
                         alpha_o[:, None] * color_o, 0.0)
        trans_occ = np.where(occ_in_front, 1.0 - alpha_o, 1.0)

    img = fixed + trans_occ[:, None] * (
        alpha[:, None] * color_obj + (1.0 - alpha)[:, None] * bg_eff)
    return img.reshape(H, W, 3)


def save_img(img, path):
    plt.imsave(path, np.clip(img, 0.0, 1.0))


# ----------------------------- analytic backward -----------------------------
def loss_and_grads(rot, trans, albedo, target, occluder=None):
    """MSE loss vs target (flat (NPIX,3)) and analytic grads w.r.t. the 9 params.

    Returns (loss, grad_rot(3), grad_trans(3), grad_albedo(3)).
    """
    R, dR = rot_mats(*rot)
    Rt = R.T
    o_l = np.broadcast_to(-Rt @ trans, RAYS.shape).copy()
    d_l = RAYS @ R
    A, B, C, Delta, q, lam, hit = intersect_ellipsoid(o_l, d_l, INV_S2)
    alpha = sigmoid(q / TAU)
    lam_safe = np.where(hit, lam, 0.0)
    color_obj, n_l, n = shade(o_l, d_l, lam_safe, R, INV_S2, albedo)
    bg_eff = np.broadcast_to(BG, (NPIX, 3)).copy()
    fixed = np.zeros((NPIX, 3))
    trans_occ = np.ones(NPIX)

    # fixed occluder: per-pixel front/back compositing
    if occluder is not None:
        inv_s2o = 1.0 / occluder["scales"] ** 2
        o_lo = np.broadcast_to(-occluder["trans"], RAYS.shape)
        _, _, _, _, q_o, lam_o, _ = intersect_ellipsoid(o_lo, RAYS, inv_s2o)
        alpha_o = sigmoid(q_o / TAU)
        lam_o_safe = np.where(np.isfinite(lam_o), lam_o, 0.0)
        color_o, _, _ = shade(o_lo, RAYS, lam_o_safe, np.eye(3), inv_s2o,
                              occluder["albedo"])
        occ_in_front = lam_o < lam
        K = alpha_o[:, None] * color_o + (1.0 - alpha_o)[:, None] * BG[None, :]
        bg_eff = np.where(occ_in_front[:, None], BG[None, :], K)
        fixed = np.where(occ_in_front[:, None],
                         alpha_o[:, None] * color_o, 0.0)
        trans_occ = np.where(occ_in_front, 1.0 - alpha_o, 1.0)

    img = fixed + trans_occ[:, None] * (
        alpha[:, None] * color_obj + (1.0 - alpha)[:, None] * bg_eff)

    resid = img - target
    loss = float(np.mean(resid**2))
    r = (2.0 / resid.size) * resid  # dL/dI, (P,3)

    # adjoint through object shading
    h = AMBIENT + (1.0 - AMBIENT) * np.maximum(0.0, n @ LIGHT_DIR)
    g_albedo = np.sum(trans_occ[:, None] * alpha[:, None] * h[:, None] * r,
                      axis=0)
    g_alpha = trans_occ * np.sum(r * (color_obj - bg_eff), axis=1)
    g_q = g_alpha * alpha * (1.0 - alpha) / TAU
    g_h = trans_occ * alpha * np.sum(r * albedo[None, :], axis=1)
    ndotl = n @ LIGHT_DIR
    g_ndotl = g_h * (1.0 - AMBIENT) * (ndotl > 0.0)
    g_n = g_ndotl[:, None] * LIGHT_DIR[None, :]
    g_n_l = g_n @ R  # row form of R @ g_n (adjoint of n = R @ n_l)
    m = (o_l + lam_safe[:, None] * d_l) * INV_S2
    norm_m = np.linalg.norm(m, axis=1)
    g_m = (g_n_l - n_l * np.sum(n_l * g_n_l, axis=1, keepdims=True)) / norm_m[:, None]
    g_p_l = g_m * INV_S2[None, :]
    g_o_l = g_p_l.copy()
    g_d_l = lam_safe[:, None] * g_p_l
    g_lam = np.where(hit, np.sum(g_p_l * d_l, axis=1), 0.0)

    # adjoints of the quadratic coefficients
    sq = np.sqrt(np.maximum(Delta, 0.0))
    g_Delta = g_q / (4.0 * A)
    g_Delta += np.where(hit, g_lam * (-1.0 / (4.0 * A * np.maximum(sq, 1e-12))), 0.0)
    g_A = g_q * (-q / A) + g_Delta * (-4.0 * C) + np.where(hit, g_lam * (-lam_safe / A), 0.0)
    g_B = g_Delta * (2.0 * B) + np.where(hit, g_lam * (-1.0 / (2.0 * A)), 0.0)
    g_C = g_Delta * (-4.0 * A)

    g_d_l += 2.0 * INV_S2[None, :] * d_l * g_A[:, None]
    g_o_l += 2.0 * INV_S2[None, :] * d_l * g_B[:, None]
    g_d_l += 2.0 * INV_S2[None, :] * o_l * g_B[:, None]
    g_o_l += 2.0 * INV_S2[None, :] * o_l * g_C[:, None]

    # pose gradients
    G_o = g_o_l.sum(axis=0)
    g_trans = -R @ G_o
    S = g_d_l.T @ RAYS  # S[i,j] = sum_p g_d_l[p,i] * d[p,j]
    g_rot = np.zeros(3)
    for k in range(3):
        Mt = dR[k].T
        g_rot[k] = -(Mt @ trans) @ G_o + np.sum(Mt * S)
    # rotation also moves the shading normal: n = R @ n_l
    Gn_Nl = g_n.T @ n_l  # [i,j] = sum_p g_n[p,i] * n_l[p,j]
    for k in range(3):
        g_rot[k] += np.sum(dR[k] * Gn_Nl)
    return loss, g_rot, g_trans, g_albedo


# ----------------------------- finite-difference check -----------------------------
PARAM_NAMES = ["rot_x", "rot_y", "rot_z", "trans_x", "trans_y", "trans_z",
               "albedo_r", "albedo_g", "albedo_b"]


def pack(rot, trans, albedo):
    return np.concatenate([rot, trans, albedo])


def unpack(theta):
    return theta[0:3], theta[3:6], theta[6:9]


def loss_only(theta, target, occluder=None):
    rot, trans, albedo = unpack(theta)
    loss, *_ = loss_and_grads(rot, trans, albedo, target, occluder)
    return loss


def grad_check(theta, target, occluder=None, eps=1e-5):
    """Central finite-difference spot check for every parameter."""
    rot, trans, albedo = unpack(theta)
    _, g_rot, g_trans, g_albedo = loss_and_grads(rot, trans, albedo, target,
                                                 occluder)
    g_ana = pack(g_rot, g_trans, g_albedo)
    g_fd = np.zeros(9)
    for i in range(9):
        d = np.zeros(9)
        d[i] = eps
        g_fd[i] = (loss_only(theta + d, target, occluder)
                   - loss_only(theta - d, target, occluder)) / (2 * eps)
    return g_ana, g_fd


# ----------------------------- optimization -----------------------------
def fit(theta_init, target, occluder=None, iters=500, lr=0.05, seed=0):
    """Adam on the 9 declared parameters. Returns (theta, history)."""
    theta = theta_init.copy()
    m1 = np.zeros(9)
    m2 = np.zeros(9)
    b1, b2, eps_adam = 0.9, 0.999, 1e-8
    hist = {"loss": [], "theta": []}
    for it in range(1, iters + 1):
        rot, trans, albedo = unpack(theta)
        loss, g_rot, g_trans, g_albedo = loss_and_grads(rot, trans, albedo,
                                                        target, occluder)
        g = pack(g_rot, g_trans, g_albedo)
        m1 = b1 * m1 + (1 - b1) * g
        m2 = b2 * m2 + (1 - b2) * g * g
        ghat = (m1 / (1 - b1**it)) / (np.sqrt(m2 / (1 - b2**it)) + eps_adam)
        # constant lr for the first 70%, then cosine decay to 0
        frac = 0.7
        if it <= frac * iters:
            lr_t = lr
        else:
            t = (it - frac * iters) / ((1.0 - frac) * iters)
            lr_t = lr * 0.5 * (1.0 + np.cos(np.pi * t))
        theta = theta - lr_t * ghat
        theta[6:9] = np.clip(theta[6:9], 0.0, 1.0)  # albedo in [0,1]
        hist["loss"].append(loss)
        hist["theta"].append(theta.copy())
    return theta, hist


def rot_err_deg(rot_est, rot_gt):
    R_e, _ = rot_mats(*rot_est)
    R_g, _ = rot_mats(*rot_gt)
    cos = (np.trace(R_e.T @ R_g) - 1.0) / 2.0
    return float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0))))


def evaluate(theta, target, occluder=None):
    """Final errors vs ground truth (GT used ONLY here, for evaluation)."""
    rot, trans, albedo = unpack(theta)
    loss = loss_only(theta, target, occluder)
    return {
        "final_loss": loss,
        "rot_err_deg": rot_err_deg(rot, GT["rot"]),
        "trans_err_l2": float(np.linalg.norm(trans - GT["trans"])),
        "albedo_err_l2": float(np.linalg.norm(albedo - GT["albedo"])),
        "rot_est": rot.tolist(),
        "trans_est": trans.tolist(),
        "albedo_est": albedo.tolist(),
    }


# ----------------------------- plotting -----------------------------
def plot_experiment(name, theta_init, theta_final, hist, target, occluder):
    rot_i, trans_i, alb_i = unpack(theta_init)
    rot_f, trans_f, alb_f = unpack(theta_final)
    img_init = render(rot_i, trans_i, alb_i, occluder)
    img_final = render(rot_f, trans_f, alb_f, occluder)
    tgt_img = target.reshape(H, W, 3)

    fig = plt.figure(figsize=(15, 8))
    gs = fig.add_gridspec(2, 4)
    axes = [fig.add_subplot(gs[0, i]) for i in range(4)]
    for ax, img, title in zip(
            axes,
            [tgt_img, img_init, img_final, np.abs(tgt_img - img_final)],
            ["target", "init render", "final render", "|target - final|"]):
        ax.imshow(np.clip(img, 0, 1))
        ax.set_title(title)
        ax.axis("off")

    ax_loss = fig.add_subplot(gs[1, 0])
    ax_loss.semilogy(hist["loss"])
    ax_loss.set_title("loss curve")
    ax_loss.set_xlabel("iter")

    traj = np.array(hist["theta"])
    gt_vec = pack(GT["rot"], GT["trans"], GT["albedo"])
    labels = [("rotation (rad)", slice(0, 3)), ("translation", slice(3, 6)),
              ("albedo", slice(6, 9))]
    for ax_idx, (title, sl) in enumerate(labels, start=1):
        ax = fig.add_subplot(gs[1, ax_idx])
        for j in range(sl.start, sl.stop):
            ax.plot(traj[:, j], label=PARAM_NAMES[j])
            ax.axhline(gt_vec[j], ls="--", alpha=0.5,
                       color=ax.lines[-1].get_color())
        ax.set_title(f"{title} trajectory (dashed = GT)")
        ax.set_xlabel("iter")
        ax.legend(fontsize=6)
    fig.suptitle(name)
    fig.tight_layout()
    path = os.path.join(OUT_DIR, f"fit_{name}.png")
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return path


def plot_loss_curves(hists):
    fig, ax = plt.subplots(figsize=(7, 5))
    for name, hist in hists.items():
        ax.semilogy(hist["loss"], label=name)
    ax.set_xlabel("iter")
    ax.set_ylabel("MSE loss")
    ax.set_title("loss curves (all experiments)")
    ax.legend()
    fig.tight_layout()
    path = os.path.join(OUT_DIR, "loss_curves.png")
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return path


if __name__ == "__main__":
    target = render(GT["rot"], GT["trans"], GT["albedo"])
    save_img(target, os.path.join(OUT_DIR, "target.png"))
    target_occ = render(GT["rot"], GT["trans"], GT["albedo"], occluder=OCCLUDER)
    save_img(target_occ, os.path.join(OUT_DIR, "target_occlusion.png"))
    tgt_flat = target.reshape(NPIX, 3)
    tgt_occ_flat = target_occ.reshape(NPIX, 3)

    # ---- finite-difference gradient spot check (arbitrary non-GT point) ----
    theta_probe = pack(np.array([0.2, -0.3, 0.1]), np.array([0.1, 0.1, 5.5]),
                       np.array([0.5, 0.5, 0.5]))
    lines = []
    for tag, tgt, occ in [("no occluder", tgt_flat, None),
                          ("with occluder", tgt_occ_flat, OCCLUDER)]:
        g_ana, g_fd = grad_check(theta_probe, tgt, occ, eps=1e-6)
        cos = float(g_ana @ g_fd /
                    (np.linalg.norm(g_ana) * np.linalg.norm(g_fd)))
        lines.append(f"=== finite-difference gradient check ({tag}) "
                     f"cosine={cos:.10f} ===")
        lines.append(f"{'param':>10} {'analytic':>13} {'finite-diff':>13} "
                     f"{'rel.err':>10}")
        for i, pname in enumerate(PARAM_NAMES):
            rel = abs(g_ana[i] - g_fd[i]) / max(1e-12, abs(g_fd[i]))
            lines.append(f"{pname:>10} {g_ana[i]:13.6e} {g_fd[i]:13.6e} "
                         f"{rel:10.2e}")
        lines.append("")
    report_grad = "\n".join(lines)
    print(report_grad)
    with open(os.path.join(OUT_DIR, "grad_check.txt"), "w") as f:
        f.write(report_grad + "\n")

    # ---- experiments: arbitrary inits, GT never read by the optimizer ----
    experiments = {
        # name: (init theta, target, occluder, iters, lr)
        "baseline": (pack(np.array([0.0, 0.0, 0.0]), np.array([0.0, 0.0, 5.0]),
                          np.array([0.5, 0.5, 0.5])), tgt_flat, None, 3000,
                     0.02),
        "occlusion": (pack(np.array([0.0, 0.0, 0.0]),
                           np.array([0.0, 0.0, 5.0]),
                           np.array([0.5, 0.5, 0.5])), tgt_occ_flat, OCCLUDER,
                      3000, 0.02),
        "bad_init": (pack(np.array([1.8, 1.2, -1.0]),
                          np.array([-1.5, 1.0, 8.0]),
                          np.array([0.10, 0.10, 0.90])), tgt_flat, None, 6000,
                     0.01),
    }
    summary = {}
    hists = {}
    for name, (theta_init, tgt, occ, iters, lr) in experiments.items():
        theta_final, hist = fit(theta_init, tgt, occluder=occ, iters=iters,
                                lr=lr)
        metrics = evaluate(theta_final, tgt, occluder=occ)
        metrics["init_loss"] = hist["loss"][0]
        metrics["converged"] = bool(metrics["final_loss"] < 1e-4)
        summary[name] = metrics
        hists[name] = hist
        plot_experiment(name, theta_init, theta_final, hist, tgt, occ)
        print(f"[{name}] init_loss={metrics['init_loss']:.6e} "
              f"final_loss={metrics['final_loss']:.6e} "
              f"rot_err={metrics['rot_err_deg']:.3f}deg "
              f"trans_err={metrics['trans_err_l2']:.4f} "
              f"albedo_err={metrics['albedo_err_l2']:.4f} "
              f"converged={metrics['converged']}")
    plot_loss_curves(hists)
    with open(os.path.join(OUT_DIR, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print("artifacts written to", OUT_DIR)
