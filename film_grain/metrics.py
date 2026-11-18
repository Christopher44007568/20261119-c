"""Measurements for film grain: spatial autocorrelation, temporal
correlation and mean-luminance shifts on flat test patches."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def spatial_autocorrelation(field: np.ndarray,
                            max_lag: int = 16) -> np.ndarray:
    """Radially averaged spatial autocorrelation of a 2D field.

    The field is centered and its autocorrelation is computed via FFT.
    Returns a 1-D array ``r(0..max_lag)`` normalized so that ``r(0) == 1``
    whenever the field has non-zero variance.
    """
    field = np.asarray(field, dtype=np.float64)
    if field.ndim != 2:
        raise ValueError("spatial_autocorrelation expects a 2D field")

    centered = field - field.mean()
    n_rows, n_cols = centered.shape
    pad_rows = int(np.ceil(n_rows / 2))
    pad_cols = int(np.ceil(n_cols / 2))
    fft = np.fft.rfft2(centered, s=(n_rows + pad_rows, n_cols + pad_cols))
    acf = np.fft.irfft2(fft * np.conj(fft))
    # irfft2 places the zero lag at index 0; roll it to the array centre.
    acf = np.roll(acf, (acf.shape[0] // 2, acf.shape[1] // 2),
                  axis=(0, 1))

    cy, cx = acf.shape[0] // 2, acf.shape[1] // 2
    yy, xx = np.mgrid[0:acf.shape[0], 0:acf.shape[1]]
    radius = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)

    radial = np.empty(max_lag + 1, dtype=np.float64)
    for lag in range(max_lag + 1):
        ring = (radius >= lag - 0.5) & (radius < lag + 0.5)
        radial[lag] = acf[ring].mean() if ring.any() else 0.0

    if radial[0] != 0.0:
        radial /= radial[0]
    return radial


def temporal_correlation(frames: np.ndarray,
                         max_lag: int | None = None) -> np.ndarray:
    """Pearson autocorrelation of frame means over time.

    ``frames`` has shape ``(T, ...)``. Returns correlations for lags
    ``0..max_lag`` with lag 0 equal to 1. Works on any per-frame scalar
    signal; by default the per-frame spatial mean is used.
    """
    frames = np.asarray(frames, dtype=np.float64)
    if frames.ndim < 2:
        raise ValueError("expected a stack of frames with shape (T, ...)")
    n_frames = frames.shape[0]
    if max_lag is None:
        max_lag = max(1, n_frames // 4)
    max_lag = min(max_lag, n_frames - 1)

    signal = frames.reshape(n_frames, -1).mean(axis=1)
    signal = signal - signal.mean()
    variance = np.dot(signal, signal)

    corr = np.empty(max_lag + 1, dtype=np.float64)
    corr[0] = 1.0
    if variance == 0.0:
        corr[1:] = 0.0
        return corr
    for lag in range(1, max_lag + 1):
        corr[lag] = np.dot(signal[:-lag], signal[lag:]) / variance
    return corr


def temporal_correlation_pixelwise(frames: np.ndarray,
                                   max_lag: int | None = None) -> np.ndarray:
    """Temporal autocorrelation averaged over every pixel time series.

    ``frames`` has shape ``(T, H, W)`` (or ``(T, H, W, C)``). Unlike the
    frame-mean estimator, spatial averaging does not attenuate the result, so
    an AR(1) grain process with coefficient ``rho`` measures close to ``rho``
    at lag 1 even on a flat patch.
    """
    frames = np.asarray(frames, dtype=np.float64)
    if frames.ndim < 3:
        raise ValueError("expected frames with shape (T, H, W[, C])")
    n_frames = frames.shape[0]
    if max_lag is None:
        max_lag = max(1, n_frames // 4)
    max_lag = min(max_lag, n_frames - 1)

    centered = frames - frames.mean(axis=0, keepdims=True)
    flat = centered.reshape(n_frames, -1)
    energy = np.sum(flat[0] * flat[0])  # stationary: same at every t
    corr = np.empty(max_lag + 1, dtype=np.float64)
    corr[0] = 1.0
    if energy == 0.0:
        corr[1:] = 0.0
        return corr
    for lag in range(1, max_lag + 1):
        corr[lag] = np.mean(
            np.sum(flat[:-lag] * flat[lag:], axis=1)) / energy
    return corr


@dataclass
class PatchResult:
    """Mean-luminance statistics for one flat test patch."""

    name: str
    level: float
    mean_before: float
    mean_after: float
    mean_delta: float
    std_after: float
    black_exact: bool


def mean_shift(before: np.ndarray, after: np.ndarray,
               name: str = "patch") -> PatchResult:
    """Compare mean luminance of a flat patch before/after grain."""
    before = np.asarray(before, dtype=np.float64)
    after = np.asarray(after, dtype=np.float64)

    def luma(img: np.ndarray) -> np.ndarray:
        if img.ndim == 2:
            return img
        weights = np.array([0.2126, 0.7152, 0.0722])
        return np.tensordot(img[..., :3], weights, axes=(-1, 0))

    lum_before = luma(before)
    lum_after = luma(after)
    return PatchResult(
        name=name,
        level=float(lum_before.mean()),
        mean_before=float(lum_before.mean()),
        mean_after=float(lum_after.mean()),
        mean_delta=float(lum_after.mean() - lum_before.mean()),
        std_after=float(lum_after.std()),
        black_exact=bool(np.array_equal(before, after))
        if lum_before.max() == 0.0 else False,
    )
