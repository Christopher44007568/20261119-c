"""Bilinear LUT sampling (mirrors the GLSL path) and error metrics."""

import numpy as np


def sample_lut(lut, ndotv, roughness):
    """Bilinear sample of an (R, R, 2) LUT at (ndotv, roughness) in [0, 1].

    Matches GPU texture sampling at texel centers: coord * R - 0.5.
    Returns (..., 2) with channels (A, B).
    """
    lut = np.asarray(lut, dtype=np.float64)
    res = lut.shape[0]
    u = np.clip(np.asarray(ndotv, dtype=np.float64), 0.0, 1.0) * res - 0.5
    v = np.clip(np.asarray(roughness, dtype=np.float64), 0.0, 1.0) * res - 0.5
    x0 = np.clip(np.floor(u), 0, res - 1).astype(np.int64)
    y0 = np.clip(np.floor(v), 0, res - 1).astype(np.int64)
    x1 = np.clip(x0 + 1, 0, res - 1)
    y1 = np.clip(y0 + 1, 0, res - 1)
    tx = np.clip(u - np.floor(u), 0.0, 1.0)[..., None]
    ty = np.clip(v - np.floor(v), 0.0, 1.0)[..., None]
    c00 = lut[y0, x0]
    c10 = lut[y0, x1]
    c01 = lut[y1, x0]
    c11 = lut[y1, x1]
    return (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty


def brightness(ab, f0=0.04):
    """Reflected factor A*F0 + B for a dielectric F0 (brightness proxy)."""
    return ab[..., 0] * f0 + ab[..., 1]


def error_stats(err):
    err = np.asarray(err, dtype=np.float64)
    return {
        "max_abs": float(np.max(np.abs(err))),
        "rms": float(np.sqrt(np.mean(err**2))),
        "mean_abs": float(np.mean(np.abs(err))),
    }
