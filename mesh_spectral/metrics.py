"""Reconstruction error and storage metrics for the spectral codec."""

from __future__ import annotations

import numpy as np


def reconstruction_errors(target_positions, reconstructed):
    """Per-vertex Euclidean error, RMSE and max error."""
    diff = np.asarray(reconstructed) - np.asarray(target_positions)
    per_vertex = np.linalg.norm(diff, axis=1)
    rmse = float(np.sqrt(np.mean(per_vertex**2)))
    return {"per_vertex": per_vertex, "rmse": rmse, "max": float(per_vertex.max())}


def raw_positions_bytes(n_vertices, dtype=np.float32):
    """Baseline: storing raw vertex positions with no compression."""
    return n_vertices * 3 * np.dtype(dtype).itemsize


def compare_basis_counts(reference, deformed_positions, ks, basis_cache=None):
    """Encode/decode at several basis counts and tabulate error vs storage.

    Returns a list of dicts with keys: k, rmse, max, payload_bytes,
    total_bytes, raw_bytes, ratio.  payload_bytes counts only the per-frame
    data (coefficients); total_bytes adds the shared, declared-once data
    (reference mesh, faces, eigenvalues, header).
    """
    from .codec import decode, encode
    from .laplacian import compute_eigenbasis

    rows = []
    raw = raw_positions_bytes(reference.n_vertices)
    for k in ks:
        basis = None
        if basis_cache is not None:
            basis = basis_cache.get(k)
            if basis is None:
                basis = compute_eigenbasis(reference, k)
                basis_cache[k] = basis
        enc = encode(reference, deformed_positions, k, basis=basis)
        recon = decode(enc)
        err = reconstruction_errors(deformed_positions, recon)
        storage = enc.storage_bytes()
        rows.append(
            {
                "k": k,
                "rmse": err["rmse"],
                "max": err["max"],
                "payload_bytes": storage["coefficients"],
                "total_bytes": storage["total"],
                "raw_bytes": raw,
                "ratio": storage["total"] / raw,
            }
        )
    return rows
