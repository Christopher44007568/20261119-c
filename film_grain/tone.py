"""Tone mapping operators (HDR linear light -> display-referred LDR).

All operators accept arrays with non-negative values and return arrays of the
same shape in roughly the [0, 1] range. Film grain is applied *after* this
stage, on the display-referred image.
"""

from __future__ import annotations

import numpy as np


def reinhard(image: np.ndarray, white: float = 1.0) -> np.ndarray:
    """Extended Reinhard tone map: L * (1 + L/white^2) / (1 + L)."""
    image = np.asarray(image, dtype=np.float64)
    if white <= 0:
        raise ValueError("white must be positive")
    white_sq = white * white
    return (image * (1.0 + image / white_sq)) / (1.0 + image)


def aces_narkowicz(image: np.ndarray) -> np.ndarray:
    """Narkowicz ACES filmic approximation, clamped to [0, 1]."""
    image = np.asarray(image, dtype=np.float64)
    a = 2.51
    b = 0.03
    c = 2.43
    d = 0.59
    e = 0.14
    mapped = ((image * (a * image + b)) /
              (image * (c * image + d) + e))
    return np.clip(mapped, 0.0, 1.0)


_OPERATORS = {
    "reinhard": reinhard,
    "aces": aces_narkowicz,
}


def apply_tone_map(image: np.ndarray,
                   operator: str = "reinhard",
                   **kwargs) -> np.ndarray:
    """Dispatch helper for the supported tone mapping operators."""
    try:
        func = _OPERATORS[operator]
    except KeyError as exc:
        raise ValueError(
            f"unknown operator {operator!r}; "
            f"choose from {sorted(_OPERATORS)}") from exc
    return func(image, **kwargs)
