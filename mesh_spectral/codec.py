"""Spectral mesh codec: project vertex displacements onto a Laplacian eigenbasis.

The encoding is genuinely spectral: the only per-frame payload is a (k, 3)
block of projection coefficients plus the shared eigenbasis declaration
(eigenvalues) and the reference mesh.  No quantized per-vertex coordinates
are stored.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import numpy as np

from .laplacian import EigenBasis, compute_eigenbasis, cotangent_laplacian
from .mesh import Mesh

FORMAT_VERSION = 1


class MeshValidationError(ValueError):
    """Raised when a mesh does not match the declared topology/reference."""


@dataclass
class SpectralEncoding:
    """Compressed representation of one deformed mesh.

    coefficients: (k, 3) float32 projection coefficients c = U^T M d of the
        displacement field d = deformed - reference.
    eigenvalues: (k,) float64 eigenvalues of the declared basis, ascending.
    reference_positions / faces: the fixed reference mesh declared alongside
        the encoding.
    topology_hash: SHA-256 over (vertex count, ordered faces, ordered
        reference positions).  Any vertex reordering changes this hash.
    """

    coefficients: np.ndarray
    eigenvalues: np.ndarray
    reference_positions: np.ndarray
    faces: np.ndarray
    topology_hash: str
    n_components: int
    version: int = FORMAT_VERSION
    meta: dict = field(default_factory=dict)

    @property
    def k(self):
        return self.coefficients.shape[0]

    @property
    def n_vertices(self):
        return self.reference_positions.shape[0]

    def reference_mesh(self):
        return Mesh(self.reference_positions, self.faces)

    def storage_bytes(self):
        """Byte accounting of every stored array (no hidden per-vertex data)."""
        coeff = self.coefficients.astype(np.float32).nbytes
        evals = self.eigenvalues.astype(np.float64).nbytes
        ref = self.reference_positions.astype(np.float32).nbytes
        faces = self.faces.astype(np.int32).nbytes
        header = len(
            json.dumps(
                {
                    "version": self.version,
                    "k": self.k,
                    "n_vertices": self.n_vertices,
                    "n_components": self.n_components,
                    "topology_hash": self.topology_hash,
                }
            ).encode()
        )
        return {
            "header": header,
            "coefficients": coeff,
            "eigenvalues": evals,
            "reference_positions": ref,
            "faces": faces,
            "total": header + coeff + evals + ref + faces,
        }


def encode(reference, deformed_positions, k, basis=None):
    """Project the displacement field onto the first k Laplacian eigenvectors."""
    deformed_positions = np.asarray(deformed_positions, dtype=np.float64)
    if deformed_positions.shape != reference.positions.shape:
        raise MeshValidationError(
            f"deformed positions shape {deformed_positions.shape} does not "
            f"match reference {reference.positions.shape}"
        )
    if basis is None:
        basis = compute_eigenbasis(reference, k)
    elif basis.k < k:
        raise ValueError(f"basis has only {basis.k} vectors, need {k}")

    _, mass = cotangent_laplacian(reference)
    displacement = deformed_positions - reference.positions
    u = basis.eigenvectors[:, :k]
    coeffs = u.T @ (mass @ displacement)  # M-orthogonal projection

    return SpectralEncoding(
        coefficients=np.asarray(coeffs, dtype=np.float32),
        eigenvalues=basis.eigenvalues[:k],
        reference_positions=reference.positions.copy(),
        faces=reference.faces.copy(),
        topology_hash=reference.topology_hash(),
        n_components=basis.n_components,
        meta={"format": "laplacian-eigenbasis", "k": k},
    )


def validate_mesh(encoding, mesh):
    """Check a mesh against the topology/reference declared in the encoding."""
    if mesh.n_vertices != encoding.n_vertices:
        raise MeshValidationError(
            f"vertex count {mesh.n_vertices} != declared {encoding.n_vertices}"
        )
    if mesh.topology_hash() != encoding.topology_hash:
        raise MeshValidationError(
            "topology hash mismatch: faces/reference positions differ or the "
            "vertex order was permuted"
        )


def _basis_for(encoding):
    mesh = encoding.reference_mesh()
    basis = compute_eigenbasis(mesh, encoding.k)
    if not np.allclose(basis.eigenvalues, encoding.eigenvalues, atol=1e-6, rtol=1e-4):
        raise MeshValidationError(
            "recomputed eigenvalues do not match the declared basis"
        )
    return basis


def reconstruct_band(encoding, lo=0, hi=None, basis=None):
    """Reconstruct positions using only eigenvectors in the band [lo, hi).

    lo/hi select the frequency band: low indices are coarse shape, high
    indices are fine detail.  Defaults to the full encoded basis.
    """
    hi = encoding.k if hi is None else hi
    if not 0 <= lo < hi <= encoding.k:
        raise ValueError(f"invalid band [{lo}, {hi}) for k={encoding.k}")
    if basis is None:
        basis = _basis_for(encoding)
    u = basis.eigenvectors[:, lo:hi]
    coeffs = encoding.coefficients[lo:hi].astype(np.float64)
    return encoding.reference_positions + u @ coeffs


def decode(encoding, mesh=None):
    """Full reconstruction; optionally validates an externally supplied mesh."""
    if mesh is not None:
        validate_mesh(encoding, mesh)
    return reconstruct_band(encoding, 0, encoding.k)
