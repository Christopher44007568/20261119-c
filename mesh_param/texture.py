"""Checkerboard texture generation and UV-based lookup."""

from __future__ import annotations

import numpy as np
from PIL import Image


def checkerboard_image(size: int = 512, cells: int = 16,
                       path: str | None = None) -> np.ndarray:
    """Return a size x size checkerboard (cells tiles per side), RGB uint8."""
    idx = np.arange(size)
    tile = (idx * cells) // size
    grid = (tile[:, None] + tile[None, :]) % 2
    img = np.where(grid[..., None], np.array([[[30, 30, 30]]], np.uint8),
                   np.array([[[235, 235, 235]]], np.uint8))
    if path:
        Image.fromarray(img).save(path)
    return img


def checker_colors(uv: np.ndarray, cells: int = 16) -> np.ndarray:
    """Map (n, 2) UVs in [0,1]-ish space to checker colors in [0,1]."""
    wrapped = np.floor(uv * cells).astype(int)
    parity = (wrapped[:, 0] + wrapped[:, 1]) % 2
    dark = np.array([0.12, 0.12, 0.12])
    light = np.array([0.92, 0.92, 0.92])
    return np.where(parity[:, None] == 1, dark, light)
