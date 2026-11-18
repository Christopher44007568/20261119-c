"""Continuous-scaling stability: no directional popping while zooming.

A shallow-slope edge is rendered once at high resolution, then
nearest-downsampled at continuously varying scale factors (the aliased
input a zoom would produce). After AA, consecutive outputs must change
smoothly: a sudden flip of the blend direction would show up as a spike
in the frame-to-frame difference and in edge jaggedness.
"""

import numpy as np

import fxaa


def _aliased_line(scale, out_size=192, big=1024, slope=0.42):
    """Shallow-slope white line, nearest-sampled at the given scale."""
    yy, xx = np.mgrid[0:out_size, 0:out_size]
    src = (np.array([yy, xx]) / scale).astype(np.int64)
    src = np.clip(src, 0, big - 1)
    line_y = (slope * np.arange(big)).astype(np.int64) + big // 16
    img = np.zeros((big, big))
    img[line_y, np.arange(big)] = 1.0
    sampled = img[src[0], src[1]]
    return np.repeat(sampled[..., None], 3, axis=-1)


def _jaggedness(luma):
    """Std-dev of the edge's vertical position across columns."""
    col_pos = []
    for x in range(luma.shape[1]):
        col = luma[:, x]
        total = col.sum()
        if total > 1e-6:
            col_pos.append((np.arange(len(col)) * col).sum() / total)
    if len(col_pos) < 8:
        return 0.0
    pos = np.array(col_pos)
    trend = np.polyfit(np.arange(len(pos)), pos, 1)
    resid = pos - np.polyval(trend, np.arange(len(pos)))
    return float(resid.std())


def run_scaling_sweep(n_steps=60, scale_lo=0.55, scale_hi=1.0):
    scales = np.linspace(scale_lo, scale_hi, n_steps)
    prev = None
    frame_diff = []
    jaggedness = []
    orientations = []
    for s in scales:
        img = _aliased_line(s)
        out = fxaa.apply_fxaa(img)
        luma = fxaa.to_luma(out["result"])
        jaggedness.append(_jaggedness(luma))
        vec = out["blend_vec"]
        strong = out["edge_mask"] > 1e-3
        # Orientation is modulo 180 deg: use the double-angle mean.
        theta = np.arctan2(vec[..., 0][strong], vec[..., 1][strong])
        mean_double = np.angle(np.exp(2j * theta).mean()) / 2.0
        orientations.append(mean_double)
        if prev is not None:
            frame_diff.append(float(np.abs(luma - prev).mean()))
        prev = luma
    frame_diff = np.array(frame_diff)
    jaggedness = np.array(jaggedness)
    orientations = np.array(orientations)
    # Smallest signed angular distance between consecutive frames.
    dtheta = np.diff(orientations)
    dtheta = (dtheta + np.pi / 2) % np.pi - np.pi / 2
    max_dir_jump = float(np.degrees(np.abs(dtheta).max()))
    # Identical consecutive frames are fine (nearest sampling quantizes
    # the scale); what must not happen is a large abrupt change.
    max_frame_diff = float(frame_diff.max())
    passed = bool(max_frame_diff < 0.05
                  and jaggedness.max() < 1.0
                  and max_dir_jump < 15.0)
    return {
        "scales": scales,
        "frame_diff": frame_diff,
        "jaggedness": jaggedness,
        "orientations": np.degrees(orientations),
        "max_frame_diff": max_frame_diff,
        "max_dir_jump_deg": max_dir_jump,
        "passed": passed,
    }
