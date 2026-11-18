"""Deterministic sample generators shared by the integrator and reference."""

import numpy as np


def hammersley(i: np.ndarray, n: int) -> np.ndarray:
    """Hammersley 2D low-discrepancy points, shape (..., 2)."""
    i = np.asarray(i, dtype=np.uint64)
    bits = i.astype(np.uint64)
    bits = ((bits & 0x5555555555555555) << 1) | ((bits >> 1) & 0x5555555555555555)
    bits = ((bits & 0x3333333333333333) << 2) | ((bits >> 2) & 0x3333333333333333)
    bits = ((bits & 0x0F0F0F0F0F0F0F0F) << 4) | ((bits >> 4) & 0x0F0F0F0F0F0F0F0F)
    bits = ((bits & 0x00FF00FF00FF00FF) << 8) | ((bits >> 8) & 0x00FF00FF00FF00FF)
    bits = ((bits & 0x0000FFFF0000FFFF) << 16) | ((bits >> 16) & 0x0000FFFF0000FFFF)
    bits = (bits << 32) | (bits >> 32)
    radical = bits.astype(np.float64) * (1.0 / 2**64)
    return np.stack([i.astype(np.float64) / n, radical], axis=-1)


def importance_sample_ggx(xi: np.ndarray, roughness: np.ndarray) -> np.ndarray:
    """GGX half-vector importance samples (tangent space, N = +Z).

    xi: (..., 2) uniforms; roughness: (...) broadcastable. Returns (..., 3).
    """
    a = np.asarray(roughness, dtype=np.float64) ** 2
    a2 = np.maximum(a * a, 1e-12)
    u = xi[..., 0]
    v = xi[..., 1]
    phi = 2.0 * np.pi * u
    cos_theta = np.sqrt((1.0 - v) / (1.0 + (a2 - 1.0) * v))
    sin_theta = np.sqrt(np.maximum(0.0, 1.0 - cos_theta * cos_theta))
    return np.stack(
        [sin_theta * np.cos(phi), sin_theta * np.sin(phi), cos_theta], axis=-1
    )
