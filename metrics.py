"""Metrics: edge preservation, per-pixel error, export/reload consistency."""

import io

import numpy as np
from PIL import Image

import fxaa


def to_uint8(img):
    return np.clip(np.round(img * 255.0), 0, 255).astype(np.uint8)


def png_roundtrip(img):
    """Encode to PNG bytes, decode again -> uint8 array."""
    buf = io.BytesIO()
    Image.fromarray(to_uint8(img)).save(buf, format="PNG")
    buf.seek(0)
    return np.asarray(Image.open(buf))


def supersample_reference(generator, size, factor=8, **kw):
    """Ground-truth AA: render large, box-downsample."""
    big = generator(size=size * factor, **kw)
    h, w = big.shape[:2]
    return big.reshape(h // factor, factor, w // factor, factor, 3).mean(
        axis=(1, 3))


def edge_preservation(before, after, keep_ratio=0.5):
    """Fraction of edge pixels whose local contrast survives AA.

    Edge pixels are found on the *input* via fxaa.edge_contrast.
    A pixel is preserved if its post-AA local contrast stays above
    keep_ratio * (original contrast). Flat inputs yield rate 1.0.
    """
    nb_in = fxaa.neighborhood(fxaa.to_luma(before))
    contrast_in, _, mask = fxaa.edge_contrast(nb_in)
    if not mask.any():
        return 1.0, 0
    nb_out = fxaa.neighborhood(fxaa.to_luma(after))
    contrast_out, _, _ = fxaa.edge_contrast(nb_out)
    survived = contrast_out[mask] >= keep_ratio * contrast_in[mask]
    return float(survived.mean()), int(mask.sum())


def per_pixel_error(result, reference):
    """Absolute per-pixel error map (luma) plus summary stats."""
    err = np.abs(fxaa.to_luma(result) - fxaa.to_luma(reference))
    return err, {
        "mae": float(err.mean()),
        "max": float(err.max()),
        "p95": float(np.percentile(err, 95)),
    }


def check_export_reload(result):
    """PNG export then reload must reproduce the 8-bit result exactly."""
    expected = to_uint8(result)
    reloaded = png_roundtrip(result)
    identical = np.array_equal(expected, reloaded)
    max_diff = int(np.abs(expected.astype(int)
                          - reloaded.astype(int)).max())
    return identical, max_diff
