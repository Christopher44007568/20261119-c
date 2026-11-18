"""Figure generation: comparisons, error heatmaps, sampling directions."""

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np


def save_comparison(path, original, result, mask, err, title, stats):
    """5-panel figure: input / edge mask / result / error heatmap / zoom."""
    fig, axes = plt.subplots(1, 5, figsize=(22, 4.6))
    panels = [
        (original, "Original", "gray"),
        (mask, "Edge mask (blend strength)", "magma"),
        (result, "AA result", "gray"),
        (err, "Per-pixel error vs reference", "hot"),
    ]
    for ax, (data, name, cmap) in zip(axes, panels):
        im = ax.imshow(data, cmap=cmap if data.ndim == 2 else None,
                       vmin=0, vmax=1 if data.ndim == 2 else None)
        ax.set_title(name, fontsize=10)
        ax.axis("off")
        if data.ndim == 2:
            fig.colorbar(im, ax=ax, fraction=0.046)
    h, w = original.shape[:2]
    cy, cx, r = h // 2, w // 2, max(h, w) // 8
    crop = result[cy - r:cy + r, cx - r:cx + r]
    axes[4].imshow(crop, interpolation="nearest")
    axes[4].set_title("Result zoom (center)", fontsize=10)
    axes[4].axis("off")
    fig.suptitle(f"{title}\n{stats}", fontsize=12)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def save_direction_map(path, img, blend_vec, is_horizontal, mask, title,
                       step=4, crop=128):
    """Overlay per-pixel sampling (blend) directions on the image.

    Arrows are direction-normalized (fixed display length) so the
    orientation field stays readable; color encodes edge orientation.
    """
    h, w = img.shape[:2]
    if crop and min(h, w) > crop:
        cy, cx = h // 2, w // 2
        r = crop // 2
        sl = (slice(cy - r, cy + r), slice(cx - r, cx + r))
        img, blend_vec, mask = img[sl], blend_vec[sl], mask[sl]
        is_horizontal = is_horizontal[sl]
        h, w = img.shape[:2]

    fig, axes = plt.subplots(1, 2, figsize=(13, 6.4))
    axes[0].imshow(img, interpolation="nearest")
    axes[0].set_title("Input (center crop)", fontsize=10)
    axes[0].axis("off")

    axes[1].imshow(img, alpha=0.35, interpolation="nearest")
    ys, xs = np.mgrid[step // 2:h:step, step // 2:w:step]
    dy = blend_vec[ys, xs, 0]
    dx = blend_vec[ys, xs, 1]
    strong = mask[ys, xs] > 1e-3
    mag = np.hypot(dx, dy)
    mag[mag < 1e-9] = 1.0
    arrow_len = step * 0.7
    ux = np.where(strong, dx / mag * arrow_len, 0.0)
    uy = np.where(strong, -dy / mag * arrow_len, 0.0)
    colors = np.where(is_horizontal[ys, xs][strong], "cyan", "magenta")
    for x, y, vx, vy, c in zip(xs[strong], ys[strong],
                               ux[strong], uy[strong], colors):
        axes[1].annotate(
            "", xy=(x + vx, y + vy), xytext=(x - vx, y - vy),
            arrowprops=dict(arrowstyle="<->", color=c, lw=1.2))
    axes[1].set_title("Sampling direction (cyan: horiz edge, "
                      "magenta: vert edge)", fontsize=10)
    axes[1].axis("off")
    fig.suptitle(title, fontsize=12)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def save_scaling_curve(path, scales, frame_diff, jaggedness, orientations):
    """Continuity curves for the scaling sweep."""
    fig, axes = plt.subplots(3, 1, figsize=(9, 9), sharex=True)
    axes[0].plot(scales[1:], frame_diff, ".-", ms=3)
    axes[0].axhline(0.05, color="r", ls="--", label="threshold = 0.05")
    axes[0].set_ylabel("frame-to-frame MAE")
    axes[0].set_title("Scaling continuity: output must vary smoothly")
    axes[0].legend()
    axes[1].plot(scales, jaggedness, ".-", ms=3, color="darkgreen")
    axes[1].set_ylabel("edge jaggedness (px)")
    axes[1].axhline(1.0, color="r", ls="--")
    axes[2].plot(scales, orientations, ".-", ms=3, color="darkblue")
    axes[2].set_ylabel("mean blend orientation (deg)")
    axes[2].set_xlabel("scale factor")
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)
