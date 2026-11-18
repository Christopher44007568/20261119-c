"""Per-iteration visualisation for the ICP registration."""
from __future__ import annotations

import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


class CorrespondenceRecorder:
    """Callback compatible with rigid_icp.register: draws correspondence
    lines (green = valid, red = rejected) for a chosen set of iterations."""

    def __init__(self, out_dir, target, keep_iterations=(0, 1, 2, 4, 8, 16, 32),
                 max_lines=400):
        self.out_dir = out_dir
        self.target = target
        self.keep = set(keep_iterations)
        self.max_lines = max_lines
        os.makedirs(out_dir, exist_ok=True)

    def __call__(self, iteration, transformed, matched, valid, record):
        if iteration not in self.keep:
            return
        fig = plt.figure(figsize=(8, 6))
        ax = fig.add_subplot(111, projection="3d")
        tgt = self.target
        stride = max(1, len(tgt) // 1500)
        ax.scatter(tgt[::stride, 0], tgt[::stride, 1], tgt[::stride, 2],
                   s=1, c="0.75", label="target")
        step = max(1, len(transformed) // self.max_lines)
        src_s = transformed[::step]
        dst_s = matched[::step]
        val_s = valid[::step]
        for p, q, ok in zip(src_s, dst_s, val_s):
            ax.plot([p[0], q[0]], [p[1], q[1]], [p[2], q[2]],
                    c="tab:green" if ok else "tab:red", lw=0.6, alpha=0.7)
        ax.scatter(src_s[:, 0], src_s[:, 1], src_s[:, 2],
                   s=4, c="tab:blue", label="source (current pose)")
        ax.set_title(
            f"iter {record.iteration}  valid {record.num_valid}/"
            f"{record.num_correspondences} ({record.valid_ratio:.0%})  "
            f"rms {record.rms_residual:.4f}\n"
            f"dR {record.delta_rotation_deg:.3f} deg  "
            f"dt {record.delta_translation:.4f}")
        ax.legend(loc="upper right", fontsize=8)
        fig.tight_layout()
        fig.savefig(os.path.join(self.out_dir, f"iter_{iteration:03d}.png"),
                    dpi=110)
        plt.close(fig)


def plot_history(history, out_path, title=""):
    it = [h.iteration for h in history]
    valid = [h.valid_ratio for h in history]
    drot = [max(h.delta_rotation_deg, 1e-12) for h in history]
    dtr = [max(h.delta_translation, 1e-12) for h in history]
    rms = [h.rms_residual for h in history]

    fig, axes = plt.subplots(1, 3, figsize=(14, 3.6))
    axes[0].plot(it, valid, "o-", ms=3)
    axes[0].set_ylabel("valid match ratio")
    axes[0].set_ylim(0, 1.05)
    axes[1].semilogy(it, drot, "o-", ms=3, label="rotation (deg)")
    axes[1].semilogy(it, dtr, "s-", ms=3, label="translation")
    axes[1].set_ylabel("increment magnitude")
    axes[1].legend(fontsize=8)
    axes[2].semilogy(it, rms, "o-", ms=3, color="tab:purple")
    axes[2].set_ylabel("rms residual")
    for ax in axes:
        ax.set_xlabel("iteration")
        ax.grid(alpha=0.3)
    if title:
        fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(out_path, dpi=110)
    plt.close(fig)
