"""Render diagnostic figures from artifacts/grain_sequences.npz."""

from __future__ import annotations

import numpy as np
import matplotlib
import sys
from pathlib import Path

matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    data = np.load("artifacts/grain_sequences.npz")
    base, fixed = data["base"], data["fixed"]
    evolving = data["evolving"]
    acf = data["acf"]
    temp_fixed, temp_evo = data["temp_fixed"], data["temp_evo"]

    fig, axes = plt.subplots(2, 2, figsize=(11, 9))

    axes[0, 0].imshow(np.clip(base, 0, 1))
    axes[0, 0].set_title("Tone-mapped input (no grain)")
    difference = np.clip(fixed[0] - base, -0.06, 0.06)
    axes[0, 1].imshow(difference.mean(axis=-1),
                      cmap="RdBu_r", vmin=-0.06, vmax=0.06)
    axes[0, 1].set_title("Grain perturbation (frame 0)")

    zoom = (slice(40, 140), slice(40, 140))
    axes[1, 0].imshow(np.clip(fixed[0][zoom], 0, 1))
    axes[1, 0].set_title("Fixed grain (static across frames)")
    axes[1, 1].imshow(np.clip(evolving[0][zoom], 0, 1))
    axes[1, 1].set_title("Evolving grain (AR(1), rho=0.8)")
    for ax in axes.flat:
        ax.set_xticks([])
        ax.set_yticks([])
    fig.tight_layout()
    fig.savefig("artifacts/grain_frames.png", dpi=130)
    plt.close(fig)

    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    lags = np.arange(acf.size)
    axes[0].bar(lags, acf, width=0.7, alpha=0.8)
    axes[0].axhline(0.0, color="k", linewidth=0.8)
    axes[0].set_title("Spatial autocorrelation (scale = 1.5 px)")
    axes[0].set_xlabel("radial lag [px]")
    axes[0].set_ylabel("normalized correlation")

    lags_t = np.arange(temp_evo.size)
    axes[1].plot(lags_t, temp_fixed, "o-", label="fixed mode")
    axes[1].plot(lags_t, temp_evo, "s-", label="evolving mode")
    axes[1].plot(lags_t, 0.8 ** lags_t, "k--", linewidth=1,
                 label="theory 0.8^lag")
    axes[1].set_title("Temporal correlation (pixel-wise)")
    axes[1].set_xlabel("time lag [frames]")
    axes[1].set_ylabel("correlation")
    axes[1].legend()
    fig.tight_layout()
    fig.savefig("artifacts/grain_correlation.png", dpi=130)
    plt.close(fig)
    print("saved artifacts/grain_frames.png and "
          "artifacts/grain_correlation.png")


if __name__ == "__main__":
    main()
