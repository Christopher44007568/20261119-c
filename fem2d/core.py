"""Linear finite element core: CST triangles, plane stress, small strain."""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla


class SingularSystemError(RuntimeError):
    """Raised when the constrained stiffness matrix is singular.

    The message names the unconstrained rigid-body modes. The solver never
    silently adds extra fixations; it is the user's responsibility to
    prescribe a statically determinate (or at least rigid-body-stable) set
    of Dirichlet boundary conditions.
    """


@dataclass(frozen=True)
class Material:
    """Isotropic linear elastic material (plane stress)."""

    E: float  # Young's modulus [Pa]
    nu: float  # Poisson's ratio [-], must be in (-1, 0.5)
    thickness: float = 1.0  # out-of-plane thickness t [m]

    def __post_init__(self):
        if self.E <= 0:
            raise ValueError("Young's modulus E must be positive")
        if not (-1.0 < self.nu < 0.5):
            raise ValueError("Poisson's ratio must be in (-1, 0.5) for plane stress")
        if self.thickness <= 0:
            raise ValueError("thickness must be positive")

    def constitutive_matrix(self) -> np.ndarray:
        """Plane-stress D matrix mapping [ex, ey, gxy] -> [sx, sy, txy]."""
        c = self.E / (1.0 - self.nu**2)
        return c * np.array(
            [
                [1.0, self.nu, 0.0],
                [self.nu, 1.0, 0.0],
                [0.0, 0.0, (1.0 - self.nu) / 2.0],
            ]
        )


def _element_matrices(coords: np.ndarray):
    """B matrix, area and Jacobian check for one 3-node triangle."""
    x1, y1 = coords[0]
    x2, y2 = coords[1]
    x3, y3 = coords[2]
    two_a = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)
    if two_a <= 0.0:
        raise ValueError("degenerate or clockwise triangle encountered")
    area = 0.5 * two_a
    b = np.array([y2 - y3, y3 - y1, y1 - y2]) / two_a
    c = np.array([x3 - x2, x1 - x3, x2 - x1]) / two_a
    B = np.array(
        [
            [b[0], 0.0, b[1], 0.0, b[2], 0.0],
            [0.0, c[0], 0.0, c[1], 0.0, c[2]],
            [c[0], b[0], c[1], b[1], c[2], b[2]],
        ]
    )
    return B, area


def assemble_stiffness(
    nodes: np.ndarray, elems: np.ndarray, mat: Material
) -> sp.csr_matrix:
    """Assemble the global stiffness matrix K (2*nnode x 2*nnode, CSR)."""
    D = mat.constitutive_matrix()
    nnode = nodes.shape[0]
    rows, cols, vals = [], [], []
    for tri in elems:
        B, area = _element_matrices(nodes[tri])
        Ke = mat.thickness * area * (B.T @ D @ B)
        dofs = np.repeat(tri * 2, 2) + np.tile([0, 1], 3)
        ii, jj = np.meshgrid(dofs, dofs, indexing="ij")
        rows.append(ii.ravel())
        cols.append(jj.ravel())
        vals.append(Ke.ravel())
    K = sp.coo_matrix(
        (np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))),
        shape=(2 * nnode, 2 * nnode),
    )
    return K.tocsr()


def rigid_body_modes(nodes: np.ndarray) -> np.ndarray:
    """Basis of the 3 planar rigid-body modes, shape (2*nnode, 3).

    Columns: x-translation, y-translation, rotation about the centroid.
    """
    nnode = nodes.shape[0]
    center = nodes.mean(axis=0)
    R = np.zeros((2 * nnode, 3))
    R[0::2, 0] = 1.0
    R[1::2, 1] = 1.0
    R[0::2, 2] = -(nodes[:, 1] - center[1])
    R[1::2, 2] = nodes[:, 0] - center[0]
    return R


_MODE_NAMES = ("x-translation", "y-translation", "rotation")


def _describe_mode(coefs: np.ndarray) -> str:
    parts = []
    for name, c in zip(_MODE_NAMES, coefs):
        if abs(c) > 1e-8 * max(abs(coefs).max(), 1.0):
            parts.append(name)
    return " + ".join(parts) if parts else "unknown"


def _check_rigid_body_modes(
    R: np.ndarray, fixed_dofs: np.ndarray, free: np.ndarray
) -> None:
    """Raise SingularSystemError if any rigid-body mode is unconstrained.

    A rigid-body mode survives the Dirichlet BCs iff there is a combination
    R @ a that vanishes on all constrained DOFs but is nonzero on the free
    DOFs. This is an exact algebraic test on the null space of R[fixed, :];
    no fixations are ever added automatically.
    """
    Rf = R[fixed_dofs, :] if fixed_dofs.size else np.zeros((0, 3))
    if Rf.size:
        _, sv, vt = np.linalg.svd(Rf)
        rank = int((sv > 1e-12 * (sv[0] if sv.size else 1.0)).sum())
        null_basis = vt[rank:].T  # columns span combinations vanishing on fixed DOFs
    else:
        null_basis = np.eye(3)
    for k in range(null_basis.shape[1]):
        a = null_basis[:, k]
        r_free = R[free, :] @ a
        if np.linalg.norm(r_free) > 1e-10 * max(np.linalg.norm(R @ a), 1.0):
            raise SingularSystemError(
                "stiffness matrix is singular: rigid-body mode "
                f"'{_describe_mode(a)}' is not restrained by the Dirichlet "
                "boundary conditions. Add displacement constraints that "
                "block this mode (no automatic fixations are applied)."
            )


def solve(
    nodes: np.ndarray,
    K: sp.csr_matrix,
    F: np.ndarray,
    fixed_dofs: np.ndarray,
    prescribed: np.ndarray | None = None,
) -> np.ndarray:
    """Solve K u = F with Dirichlet BCs by elimination.

    Parameters
    ----------
    fixed_dofs : constrained DOF indices (u = prescribed values there)
    prescribed : values at fixed_dofs (defaults to zero)

    Raises SingularSystemError if the remaining system is singular, e.g.
    when rigid-body degrees of freedom are left unconstrained.
    """
    ndof = K.shape[0]
    fixed_dofs = np.asarray(fixed_dofs, dtype=int)
    if prescribed is None:
        prescribed = np.zeros(fixed_dofs.shape[0])
    prescribed = np.asarray(prescribed, dtype=float)

    is_fixed = np.zeros(ndof, dtype=bool)
    is_fixed[fixed_dofs] = True
    free = np.flatnonzero(~is_fixed)

    u = np.zeros(ndof)
    u[fixed_dofs] = prescribed
    rhs = F - K[:, fixed_dofs] @ prescribed

    if free.size == 0:
        return u

    K_ff = K[free][:, free].tocsc()
    _check_rigid_body_modes(rigid_body_modes(nodes), fixed_dofs, free)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", spla.MatrixRankWarning)
            u[free] = spla.spsolve(K_ff, rhs[free])
    except (RuntimeError, spla.MatrixRankWarning) as exc:
        raise SingularSystemError(
            "stiffness matrix is singular or ill-conditioned beyond "
            "rigid-body-mode checks; inspect boundary conditions and mesh. "
            f"(sparse solver reported: {exc})"
        ) from exc
    if not np.all(np.isfinite(u)):
        raise SingularSystemError(
            "solve produced non-finite values; the system is likely singular."
        )
    return u


def reaction_forces(K: sp.csr_matrix, u: np.ndarray, F: np.ndarray) -> np.ndarray:
    """Nodal reaction vector R = K u - F (nonzero at constrained DOFs)."""
    return K @ u - F


def element_strains(nodes: np.ndarray, elems: np.ndarray, u: np.ndarray) -> np.ndarray:
    """Constant strain [ex, ey, gxy] per element (engineering shear)."""
    out = np.zeros((elems.shape[0], 3))
    for e, tri in enumerate(elems):
        B, _ = _element_matrices(nodes[tri])
        dofs = np.repeat(tri * 2, 2) + np.tile([0, 1], 3)
        out[e] = B @ u[dofs]
    return out


def element_stresses(strains: np.ndarray, mat: Material) -> np.ndarray:
    """Stress [sx, sy, txy] per element from element strains."""
    return strains @ mat.constitutive_matrix().T
