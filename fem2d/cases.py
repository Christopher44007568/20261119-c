"""Predefined boundary-condition / load cases for the rectangular plate."""

from __future__ import annotations

import numpy as np

from .mesh import boundary_nodes


def edge_traction_load(
    nodes: np.ndarray, side: str, traction: tuple[float, float], thickness: float
) -> np.ndarray:
    """Consistent nodal load vector for a uniform traction on one edge.

    Traction (tx, ty) is force per unit area; the edge integral is lumped
    consistently to the boundary nodes (1/2 of each boundary segment to
    each of its endpoints).
    """
    bnodes = boundary_nodes(nodes, side)
    pos = nodes[bnodes]
    # Order nodes along the edge and integrate segment by segment.
    axis = 1 if side in ("left", "right") else 0
    order = np.argsort(pos[:, axis])
    bnodes = bnodes[order]
    tx, ty = traction
    F = np.zeros(2 * nodes.shape[0])
    for k in range(len(bnodes) - 1):
        na, nb = bnodes[k], bnodes[k + 1]
        seg = np.linalg.norm(nodes[nb] - nodes[na])
        for n in (na, nb):
            F[2 * n] += 0.5 * seg * thickness * tx
            F[2 * n + 1] += 0.5 * seg * thickness * ty
    return F


def tension_case(nodes: np.ndarray, mat_thickness: float, sigma: float):
    """Uniaxial tension: left edge ux=0, lower-left corner uy=0, right edge
    loaded with uniform normal traction sigma (force/area).

    Returns (fixed_dofs, prescribed, F, description).
    """
    left = boundary_nodes(nodes, "left")
    right_load = edge_traction_load(nodes, "right", (sigma, 0.0), mat_thickness)
    fixed = list(2 * left)  # ux = 0 on left edge
    # Kill the remaining rigid-body modes (y-translation, rotation) with a
    # single uy constraint at the lower-left corner -- statically determinate.
    corner = left[np.argmin(nodes[left, 1])]
    fixed.append(2 * corner + 1)
    fixed_dofs = np.array(sorted(fixed), dtype=int)
    prescribed = np.zeros(fixed_dofs.shape[0])
    desc = (
        f"uniaxial tension, sigma={sigma:g} Pa on right edge; "
        "left edge ux=0, lower-left corner uy=0"
    )
    return fixed_dofs, prescribed, right_load, desc


def cantilever_case(nodes: np.ndarray, mat_thickness: float, P: float):
    """Cantilever: left edge fully clamped, downward point resultant P
    distributed as uniform shear traction on the right edge.

    Returns (fixed_dofs, prescribed, F, description).
    """
    left = boundary_nodes(nodes, "left")
    fixed_dofs = np.sort(np.concatenate([2 * left, 2 * left + 1]))
    prescribed = np.zeros(fixed_dofs.shape[0])
    H = nodes[:, 1].max() - nodes[:, 1].min()
    tau = -P / (H * mat_thickness)  # uniform shear traction on right edge
    F = edge_traction_load(nodes, "right", (0.0, tau), mat_thickness)
    desc = (
        f"cantilever, end shear resultant P={P:g} N on right edge; "
        "left edge fully clamped"
    )
    return fixed_dofs, prescribed, F, desc
