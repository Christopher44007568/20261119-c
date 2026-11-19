"""Matplotlib visualization: deformed shape, displacement, strain, reactions."""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np


def _node_values_from_elements(elems: np.ndarray, elem_vals: np.ndarray, nnode: int):
    acc = np.zeros(nnode)
    cnt = np.zeros(nnode)
    for e, tri in enumerate(elems):
        acc[tri] += elem_vals[e]
        cnt[tri] += 1
    cnt[cnt == 0] = 1
    return acc / cnt


def plot_results(
    nodes,
    elems,
    u,
    strains,
    reactions,
    fixed_dofs,
    path: str,
    title: str = "",
    scale: float = None,
):
    """4-panel figure: deformed mesh, |u|, equivalent strain, reactions."""
    ux, uy = u[0::2], u[1::2]
    umag = np.hypot(ux, uy)
    L = np.ptp(nodes[:, 0])
    H = np.ptp(nodes[:, 1])
    if scale is None:
        umax = umag.max()
        scale = 0.15 * max(L, H) / umax if umax > 0 else 1.0
    deformed = nodes + scale * u.reshape(-1, 2)

    ex, ey, gxy = strains.T
    eq_strain = np.sqrt(2.0 / 3.0 * ((ex - ey) ** 2 + ex**2 + ey**2) + gxy**2 / 3.0)

    fig, axes = plt.subplots(2, 2, figsize=(13, 8))
    fig.suptitle(title)

    ax = axes[0, 0]
    ax.triplot(nodes[:, 0], nodes[:, 1], elems, color="0.8", lw=0.5)
    ax.triplot(deformed[:, 0], deformed[:, 1], elems, color="tab:blue", lw=0.7)
    ax.set_title(f"deformed mesh (x{scale:.3g})")

    ax = axes[0, 1]
    tp = ax.tripcolor(
        deformed[:, 0], deformed[:, 1], elems, umag, shading="gouraud", cmap="viridis"
    )
    fig.colorbar(tp, ax=ax, label="|u| [m]")
    ax.set_title("displacement magnitude")

    ax = axes[1, 0]
    eq_node = _node_values_from_elements(elems, eq_strain, nodes.shape[0])
    tp = ax.tripcolor(
        deformed[:, 0], deformed[:, 1], elems, eq_node, shading="gouraud", cmap="inferno"
    )
    fig.colorbar(tp, ax=ax, label="eq. strain [-]")
    ax.set_title("equivalent strain")

    ax = axes[1, 1]
    ax.triplot(deformed[:, 0], deformed[:, 1], elems, color="0.85", lw=0.5)
    rx, ry = reactions[0::2], reactions[1::2]
    rmag = np.hypot(rx, ry)
    rmax = rmag.max() if rmag.size else 0.0
    if rmax > 0:
        idx = np.flatnonzero(rmag > 1e-9 * rmax)
        qscale = 0.1 * max(L, H) / rmax
        ax.quiver(
            deformed[idx, 0],
            deformed[idx, 1],
            rx[idx] * qscale,
            ry[idx] * qscale,
            angles="xy",
            scale_units="xy",
            scale=1,
            color="tab:red",
            width=0.004,
        )
    fx = np.unique(np.asarray(fixed_dofs) // 2)
    ax.plot(
        deformed[fx, 0], deformed[fx, 1], "s", ms=3, color="tab:green",
        label="fixed nodes",
    )
    ax.legend(loc="upper right", fontsize=8)
    ax.set_title("reaction forces (red arrows)")

    for ax in axes.ravel():
        ax.set_aspect("equal")
        ax.set_xlabel("x [m]")
        ax.set_ylabel("y [m]")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
