"""Mesh Laplacian eigenbasis compression."""

from .codec import (
    MeshValidationError,
    SpectralEncoding,
    decode,
    encode,
    reconstruct_band,
    validate_mesh,
)
from .laplacian import EigenBasis, compute_eigenbasis, count_connected_components
from .mesh import Mesh, two_component_mesh, uv_sphere
from .metrics import compare_basis_counts, reconstruction_errors

__all__ = [
    "EigenBasis",
    "Mesh",
    "MeshValidationError",
    "SpectralEncoding",
    "compare_basis_counts",
    "compute_eigenbasis",
    "count_connected_components",
    "decode",
    "encode",
    "reconstruct_band",
    "reconstruction_errors",
    "two_component_mesh",
    "uv_sphere",
    "validate_mesh",
]
