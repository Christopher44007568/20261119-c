"""Fast edge anti-aliasing driven by luminance difference (FXAA-style).

Pipeline:
  1. RGB -> luma.
  2. Per-pixel local contrast -> edge mask with low-contrast attenuation.
  3. Edge orientation from 3x3 neighborhood -> blend along the edge.
  4. Thin-feature guard so 1px lines/text strokes are not erased.
  5. End-of-edge search along the edge to modulate blend length.
"""

import numpy as np

LUMA_WEIGHTS = np.array([0.299, 0.587, 0.114], dtype=np.float64)


def to_luma(img):
    """img: float64 HxWx3 in [0,1] -> HxW luma."""
    return img @ LUMA_WEIGHTS


def neighborhood(luma):
    """Return the 3x3 luma neighborhood as a dict of padded views."""
    p = np.pad(luma, 1, mode="edge")
    return {
        "nw": p[:-2, :-2], "n": p[:-2, 1:-1], "ne": p[:-2, 2:],
        "w": p[1:-1, :-2], "c": p[1:-1, 1:-1], "e": p[1:-1, 2:],
        "sw": p[2:, :-2], "s": p[2:, 1:-1], "se": p[2:, 2:],
    }


def edge_contrast(nb, rel_threshold=0.063, abs_threshold=0.031):
    """Local contrast and raw edge mask (before attenuation).

    Pixels whose local range is below max(abs_threshold,
    rel_threshold * local_max) are considered flat and excluded.
    """
    stack = np.stack([nb["c"], nb["n"], nb["s"], nb["e"], nb["w"]])
    luma_min = stack.min(axis=0)
    luma_max = stack.max(axis=0)
    contrast = luma_max - luma_min
    threshold = np.maximum(abs_threshold, rel_threshold * luma_max)
    mask = contrast >= threshold
    return contrast, threshold, mask


def edge_direction(nb):
    """Estimate edge orientation from the 3x3 luma neighborhood.

    Returns (is_horizontal, dir_sign):
      is_horizontal[y, x] True  -> edge runs horizontally, blend N/S.
      dir_sign[y, x] in {-1, 1} -> which side of the edge is darker,
      used to pick the blend offset direction.
    """
    # grad_y measures the vertical gradient (top vs bottom rows);
    # grad_x measures the horizontal gradient (left vs right columns).
    # A strong vertical gradient means the edge line runs horizontally.
    grad_y = (
        np.abs(nb["nw"] + 2.0 * nb["n"] + nb["ne"]
               - nb["sw"] - 2.0 * nb["s"] - nb["se"])
    )
    grad_x = (
        np.abs(nb["nw"] + 2.0 * nb["w"] + nb["sw"]
               - nb["ne"] - 2.0 * nb["e"] - nb["se"])
    )
    is_horizontal = grad_y >= grad_x

    grad_n = np.abs(nb["n"] - nb["c"])
    grad_s = np.abs(nb["s"] - nb["c"])
    grad_w = np.abs(nb["w"] - nb["c"])
    grad_e = np.abs(nb["e"] - nb["c"])

    # Blend toward the neighbour with the stronger gradient (edge side).
    sign_h = np.where(grad_n >= grad_s, -1.0, 1.0)   # -1 -> toward N
    sign_v = np.where(grad_w >= grad_e, -1.0, 1.0)   # -1 -> toward W
    dir_sign = np.where(is_horizontal, sign_h, sign_v)
    return is_horizontal, dir_sign


def thin_feature_guard(nb, is_horizontal):
    """Detect 1px-thin features (lines, text strokes) along the blend axis.

    A pixel whose luma is a strict extremum relative to BOTH neighbours
    along the blend axis sits on a thin ridge/valley; blending it toward
    one side would erase it. Returns an attenuation factor in [0, 1].
    """
    c = nb["c"]
    axis_a = np.where(is_horizontal, nb["n"], nb["w"])
    axis_b = np.where(is_horizontal, nb["s"], nb["e"])
    eps = 1.0 / 512.0
    is_peak = (c > axis_a + eps) & (c > axis_b + eps)
    is_valley = (c < axis_a - eps) & (c < axis_b - eps)
    thin = is_peak | is_valley

    # Border case: edge padding duplicates the outermost pixel, which
    # hides a 1px line sitting exactly on the image boundary. For border
    # pixels, compare against the two inward neighbours instead.
    h, w = c.shape
    p2 = np.pad(c, 2, mode="edge")
    n2 = p2[:-4, 2:-2]
    s2 = p2[4:, 2:-2]
    w2 = p2[2:-2, :-4]
    e2 = p2[2:-2, 4:]
    ys, xs = np.mgrid[0:h, 0:w]
    top_bot = (ys == 0) | (ys == h - 1)
    left_right = (xs == 0) | (xs == w - 1)
    at_border = np.where(is_horizontal, top_bot, left_right)
    in1 = np.where(is_horizontal,
                   np.where(ys == 0, nb["s"], nb["n"]),
                   np.where(xs == 0, nb["e"], nb["w"]))
    in2 = np.where(is_horizontal,
                   np.where(ys == 0, s2, n2),
                   np.where(xs == 0, e2, w2))
    border_peak = at_border & (c > in1 + eps) & (c > in2 + eps)
    border_valley = at_border & (c < in1 - eps) & (c < in2 - eps)
    thin |= border_peak | border_valley
    return np.where(thin, 0.15, 1.0)


def bilinear_sample(img, ys, xs):
    """Bilinear sample of HxW(...) array at float coords, edge-clamped."""
    h, w = img.shape[:2]
    ys = np.clip(ys, 0.0, h - 1.0)
    xs = np.clip(xs, 0.0, w - 1.0)
    y0 = np.floor(ys).astype(np.int64)
    x0 = np.floor(xs).astype(np.int64)
    y1 = np.minimum(y0 + 1, h - 1)
    x1 = np.minimum(x0 + 1, w - 1)
    fy = (ys - y0)[..., None] if img.ndim == 3 else ys - y0
    fx = (xs - x0)[..., None] if img.ndim == 3 else xs - x0
    c00 = img[y0, x0]
    c01 = img[y0, x1]
    c10 = img[y1, x0]
    c11 = img[y1, x1]
    return (c00 * (1 - fx) * (1 - fy) + c01 * fx * (1 - fy)
            + c10 * (1 - fx) * fy + c11 * fx * fy)


SEARCH_STEPS = (1.0, 1.5, 2.0, 2.0, 4.0)


def _search_edge_end(luma, ys, xs, ty, tx, luma_ref, limit):
    """March along tangent (ty, tx) until luma leaves the edge range."""
    dist = np.zeros(luma.shape)
    active = np.ones(luma.shape, dtype=bool)
    cy, cx = ys.copy(), xs.copy()
    for step in SEARCH_STEPS:
        cy = cy + ty * step
        cx = cx + tx * step
        sample = bilinear_sample(luma, cy, cx)
        done = np.abs(sample - luma_ref) >= limit
        dist = np.where(active, dist + step, dist)
        active &= ~done
    return dist


def apply_fxaa(img, rel_threshold=0.063, abs_threshold=0.031,
               max_blend=0.75):
    """Run the full AA pass.

    img: float64 HxWx3 in [0, 1].
    Returns dict with:
      result    HxWx3 anti-aliased image
      edge_mask HxW  final blend strength in [0, 1]
      blend_vec HxWx2 per-pixel blend offset (dy, dx) actually applied
      is_horizontal HxW bool edge orientation map
    """
    luma = to_luma(img)
    nb = neighborhood(luma)
    contrast, threshold, mask = edge_contrast(
        nb, rel_threshold, abs_threshold)

    is_horiz, dir_sign = edge_direction(nb)
    guard = thin_feature_guard(nb, is_horiz)

    # Low-contrast attenuation: soft ramp just above the threshold.
    atten = np.clip((contrast - threshold) / (threshold + 1e-6), 0.0, 1.0)

    h, w = luma.shape
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)

    # Perpendicular unit offset toward the edge side.
    py = np.where(is_horiz, dir_sign, 0.0)
    px = np.where(is_horiz, 0.0, dir_sign)
    # Tangent runs along the edge.
    ty, tx = -px, py

    # Sample at the boundary between the pixel and its edge-side neighbour.
    by = ys + 0.5 * py
    bx = xs + 0.5 * px
    luma_b = bilinear_sample(luma, by, bx)
    grad_limit = 0.25 * np.maximum(contrast, 1e-6)

    dist_neg = _search_edge_end(luma, by, bx, -ty, -tx, luma_b, grad_limit)
    dist_pos = _search_edge_end(luma, by, bx, ty, tx, luma_b, grad_limit)

    total = dist_neg + dist_pos + 1e-6
    dist_min = np.minimum(dist_neg, dist_pos)
    # Full blend mid-edge; fades to 0 near an edge end (corners stay
    # sharp instead of being rounded off).
    length_blend = np.clip(2.0 * dist_min / total, 0.0, 1.0) * 0.5

    blend = max_blend * length_blend * atten * guard
    blend = np.where(mask, blend, 0.0)

    off_y = py * blend
    off_x = px * blend
    result = bilinear_sample(img, ys + off_y, xs + off_x)
    result = np.clip(result, 0.0, 1.0)

    return {
        "result": result,
        "edge_mask": blend,
        "blend_vec": np.stack([off_y, off_x], axis=-1),
        "is_horizontal": is_horiz,
    }
