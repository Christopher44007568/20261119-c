"""Discrete Laplace-Beltrami operator and its eigenbasis."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

ZERO_EIGENVALUE_RTOL = 1e-5


def cotangent_laplacian(mesh):
    """Cotangent stiffness matrix L and lumped diagonal mass matrix M.

    L is symmetric positive semidefinite; the generalized problem
    L u = lambda M u yields M-orthonormal eigenvectors.
    """
    v = mesh.positions
    f = mesh.faces
    n = mesh.n_vertices

    v0, v1, v2 = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]

    def cotangent(a, b):
        cos = np.einsum("ij,ij->i", a, b)
        sin = np.linalg.norm(np.cross(a, b), axis=1)
        sin = np.maximum(sin, 1e-12)
        return cos / sin

    cot0 = cotangent(v1 - v0, v2 - v0)
    cot1 = cotangent(v2 - v1, v0 - v1)
    cot2 = cotangent(v0 - v2, v1 - v2)

    rows = np.concatenate([f[:, 1], f[:, 2], f[:, 2], f[:, 0], f[:, 0], f[:, 1]])
    cols = np.concatenate([f[:, 2], f[:, 1], f[:, 0], f[:, 2], f[:, 1], f[:, 0]])
    vals = 0.5 * np.concatenate([cot0, cot0, cot1, cot1, cot2, cot2])
    w = sp.coo_matrix((vals, (rows, cols)), shape=(n, n)).tocsr()
    w.sum_duplicates()

    diag = np.asarray(w.sum(axis=1)).ravel()
    lap = sp.diags(diag) - w

    cross = np.cross(v1 - v0, v2 - v0)
    face_area = 0.5 * np.linalg.norm(cross, axis=1)
    mass = np.zeros(n)
    for corner in range(3):
        np.add.at(mass, f[:, corner], face_area / 3.0)
    mass = np.maximum(mass, 1e-12)
    return lap.tocsr(), sp.diags(mass).tocsr()


def count_connected_components(mesh):
    """Number of connected components of the edge graph."""
    n = mesh.n_vertices
    f = mesh.faces
    rows = np.concatenate([f[:, 0], f[:, 1], f[:, 1], f[:, 2], f[:, 2], f[:, 0]])
    cols = np.concatenate([f[:, 1], f[:, 0], f[:, 2], f[:, 1], f[:, 0], f[:, 2]])
    adj = sp.coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n))
    return sp.csgraph.connected_components(adj, directed=False)[0]


@dataclass
class EigenBasis:
    """First k eigenpairs of (L, M), eigenvectors M-orthonormal."""

    eigenvalues: np.ndarray
    eigenvectors: np.ndarray
    n_components: int

    @property
    def k(self):
        return self.eigenvalues.shape[0]

    def n_zero_eigenvalues(self):
        scale = max(float(self.eigenvalues[-1]), 1e-12)
        tol = ZERO_EIGENVALUE_RTOL * scale
        return int(np.count_nonzero(self.eigenvalues < tol))


def compute_eigenbasis(mesh, k):
    """Smallest-k generalized eigenpairs via shift-invert around zero.

    The solver is seeded with a fixed starting vector so that repeated
    calls (encoder and decoder alike) produce identical eigenvectors,
    including within degenerate eigenspaces.
    """
    n = mesh.n_vertices
    if not 1 <= k <= n:
        raise ValueError(f"k must be in [1, {n}], got {k}")
    lap, mass = cotangent_laplacian(mesh)
    n_components = count_connected_components(mesh)

    if k >= n:
        import scipy.linalg

        evals, evecs = scipy.linalg.eigh(lap.toarray(), mass.toarray())
        evals = np.maximum(evals, 0.0)
        return EigenBasis(evals, evecs, n_components)

    v0 = np.random.default_rng(20261119).standard_normal(n)
    evals, evecs = spla.eigsh(lap, k=k, M=mass, sigma=0.0, which="LM", v0=v0)
    order = np.argsort(evals)
    evals, evecs = evals[order], evecs[:, order]
    evals = np.maximum(evals, 0.0)

    basis = EigenBasis(evals, evecs, n_components)
    n_zero = basis.n_zero_eigenvalues()
    if n_zero != n_components:
        raise RuntimeError(
            f"expected {n_components} zero eigenvalues (one per connected "
            f"component), got {n_zero}; increase k or check the mesh"
        )
    return basis
