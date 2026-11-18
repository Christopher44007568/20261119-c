"""Synthetic test scenes for the edge-AA evaluation.

Every generator returns a float64 HxWx3 image in [0, 1].
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def hard_edges(size=256):
    """Axis-aligned + diagonal step edges and a filled circle."""
    img = np.zeros((size, size, 3))
    img[:, size // 2:] = [0.9, 0.2, 0.2]
    yy, xx = np.mgrid[0:size, 0:size]
    img[yy > xx] = [0.2, 0.2, 0.9]
    r = size // 6
    disk = (yy - size * 3 // 4) ** 2 + (xx - size // 4) ** 2 < r * r
    img[disk] = [0.2, 0.85, 0.3]
    return img


def gradient(size=256):
    """Smooth gradients: linear, radial, and a soft diagonal ramp."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64) / (size - 1)
    img = np.stack([xx, yy, (xx + yy) / 2.0], axis=-1)
    rad = np.sqrt((xx - 0.5) ** 2 + (yy - 0.5) ** 2)
    img[..., 0] = np.clip(rad * 1.4, 0, 1)
    return img


def noise(size=256, seed=7):
    """Uniform white noise."""
    rng = np.random.RandomState(seed)
    return rng.rand(size, size, 3)


def diagonal_line(size=256, thickness=1):
    """One-pixel white diagonal line on black, plus a shallow-slope line."""
    img = np.zeros((size, size, 3))
    for i in range(size):
        img[i, i:i + thickness] = 1.0
    # 2:1 slope line (classic jaggy case)
    for x in range(size // 2, size):
        y = (x - size // 2) // 2 + size // 8
        if 0 <= y < size:
            img[y, x] = 1.0
    return img


def checkerboard(size=256, cells=32):
    """1-cell-per-tile checkerboard (worst case for edge filters)."""
    yy, xx = np.mgrid[0:size, 0:size]
    tile = size // cells
    board = ((yy // tile) + (xx // tile)) % 2
    return np.repeat(board[..., None].astype(np.float64), 3, axis=-1)


def low_contrast_text(size=256, contrast=0.10, base=0.5):
    """Dark-grey text on slightly lighter grey background."""
    img = Image.new("RGB", (size, size),
                    tuple(int(round(base * 255)) for _ in range(3)))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", size // 8)
    except OSError:
        font = ImageFont.load_default()
    fg = tuple(int(round((base - contrast) * 255)) for _ in range(3))
    draw.text((size // 16, size // 3), "Edge AA 123", fill=fg, font=font)
    draw.text((size // 16, size // 2), "thin strokes", fill=fg, font=font)
    return np.asarray(img, dtype=np.float64) / 255.0


def flat_blocks(size=256):
    """Large flat color blocks: output must equal input exactly."""
    img = np.zeros((size, size, 3))
    img[:size // 2, :size // 2] = [0.8, 0.7, 0.1]
    img[:size // 2, size // 2:] = [0.1, 0.3, 0.6]
    img[size // 2:, :size // 2] = [0.5, 0.5, 0.5]
    img[size // 2:, size // 2:] = [0.05, 0.05, 0.05]
    return img


def size_boundary(width=191, height=137):
    """Odd, non-power-of-two dimensions with edges touching the border."""
    img = np.zeros((height, width, 3))
    img[:, :] = [0.15, 0.15, 0.2]
    img[0:1, :] = 1.0            # edge touches the top border
    img[:, -1:] = 1.0            # and the right border
    yy, xx = np.mgrid[0:height, 0:width]
    img[yy > xx * height / width] = [0.9, 0.5, 0.1]
    return img


SCENARIOS = {
    "hard_edges": hard_edges,
    "gradient": gradient,
    "noise": noise,
    "diagonal_line": diagonal_line,
    "checkerboard": checkerboard,
    "low_contrast_text": low_contrast_text,
    "flat_blocks": flat_blocks,
    "size_boundary": size_boundary,
}
