"""Matplotlib figures for the BRDF LUT analysis (Agg backend, no display)."""

import matplotlib

matplotlib.use("Agg")

import os
import sys

import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from brdf.evaluate import sample_lut


def make_lut_preview(lut, path):
    fig, ax = plt.subplots(figsize=(6, 5), constrained_layout=True)
    rgb = np.zeros(lut.shape[:2] + (3,))
    rgb[..., 0] = lut[..., 0]
    rgb[..., 1] = lut[..., 1]
    ax.imshow(rgb, origin="lower", extent=[0, 1, 0, 1], aspect="auto")
    ax.set_xlabel("NdotV")
    ax.set_ylabel("roughness")
    ax.set_title(f"environment BRDF LUT {lut.shape[0]} (R=A, G=B)")
    fig.savefig(path, dpi=150)
    plt.close(fig)


def make_heatmap(err, path):
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.2), constrained_layout=True)
    sat = max(5e-3, np.percentile(np.abs(err), 99.9))
    im0 = axes[0].imshow(
        err,
        origin="lower",
        extent=[0, 1, 0, 1],
        aspect="auto",
        cmap="RdBu_r",
        vmin=-sat,
        vmax=sat,
    )
    axes[0].set_title(f"signed error (saturated at +/-{sat:.1e})")
    fig.colorbar(im0, ax=axes[0], label="LUT - reference")
    abs_err = np.maximum(np.abs(err), 1e-8)
    im1 = axes[1].imshow(
        np.log10(abs_err),
        origin="lower",
        extent=[0, 1, 0, 1],
        aspect="auto",
        cmap="viridis",
    )
    axes[1].set_title("log10 |error|")
    fig.colorbar(im1, ax=axes[1], label="log10 abs error")
    for ax in axes:
        ax.set_xlabel("NdotV")
        ax.set_ylabel("roughness")
    peak = np.unravel_index(np.argmax(np.abs(err)), err.shape)
    n = err.shape[0]
    fig.suptitle(
        f"LUT(128) vs reference, brightness (F0=0.04); "
        f"max {err[peak]:.3e} at NdotV={(peak[1]+0.5)/n:.3f}, "
        f"roughness={(peak[0]+0.5)/n:.3f}"
    )
    fig.savefig(path, dpi=150)
    plt.close(fig)


def make_resolution_plot(rows, path):
    rows = np.asarray(rows)
    fig, ax = plt.subplots(figsize=(6, 4.5), constrained_layout=True)
    ax.loglog(rows[:, 0], rows[:, 1], "o-", label="max abs")
    ax.loglog(rows[:, 0], rows[:, 2], "s-", label="rms")
    ax.loglog(rows[:, 0], rows[:, 3], "^-", label="max abs (NdotV >= 0.05)")
    ax.set_xlabel("LUT resolution (texels per axis)")
    ax.set_ylabel("brightness error (F0 = 0.04)")
    ax.set_title("LUT lookup error vs table resolution")
    ax.grid(True, which="both", alpha=0.3)
    ax.legend()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def make_continuity_plot(lut, path):
    """Dense roughness sweeps at fixed NdotV through the bilinear sampler.

    Bilinear interpolation is C0 by construction; this verifies there are
    no texel discontinuities and reports the largest per-step jump.
    """
    rough_dense = np.linspace(0.0, 1.0, 4001)
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2), constrained_layout=True)
    max_jump = 0.0
    for nv, style in [(0.1, "-"), (0.5, "--"), (0.9, ":")]:
        ab = sample_lut(lut, np.full_like(rough_dense, nv), rough_dense)
        axes[0].plot(rough_dense, ab[:, 0], style, label=f"NdotV={nv}")
        axes[1].plot(rough_dense, ab[:, 1], style, label=f"NdotV={nv}")
        max_jump = max(max_jump, np.max(np.abs(np.diff(ab, axis=0))))
    axes[0].set_ylabel("A (scale)")
    axes[1].set_ylabel("B (bias)")
    for ax in axes:
        ax.set_xlabel("roughness")
        ax.grid(alpha=0.3)
        ax.legend()
    fig.suptitle(f"LUT({lut.shape[0]}) roughness sweep, max step {max_jump:.2e}")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"continuity: max per-step jump over 4000 steps = {max_jump:.3e}")
