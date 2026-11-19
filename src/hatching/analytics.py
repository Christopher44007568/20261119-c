"""Quantitative checks against analytic ground truth.

The four test surfaces are parametric, so exact principal curvatures and
directions are known.  We report curvature magnitude errors and principal
direction angle errors (only where the estimator is confident, since an
umbilic point has no well-defined principal direction).
"""

from __future__ import annotations

import numpy as np


def ground_truth(mesh):
    """Return (k1, k2, d1, d2) analytically at every vertex."""
    p = mesh.vertices
    n = len(p)
    k1 = np.zeros(n)
    k2 = np.zeros(n)
    d1 = np.zeros((n, 3))
    d2 = np.zeros((n, 3))
    name = mesh.name

    if name == "cylinder":
        r = np.hypot(p[:, 0], p[:, 1])
        # Algebraic convention k1 >= k2: axial direction is flat (k=0),
        # circumferential direction carries the positive sectional curvature.
        k1[:] = 1.0 / r
        k2[:] = 0.0
        d1[:] = np.column_stack([-p[:, 1] / r, p[:, 0] / r, np.zeros(n)])
        d2[:] = np.array([0.0, 0.0, 1.0])
    elif name == "sphere":
        r = np.linalg.norm(p, axis=1)
        k1[:] = 1.0 / r
        k2[:] = 1.0 / r
        # Umbilic: no canonical direction; leave zeros (excluded from stats).
    elif name == "saddle":
        x, y = p[:, 0], p[:, 1]
        a = 0.6
        denom = 1.0 + (a * y) ** 2 + (a * x) ** 2
        # Shape operator of z = axy, oriented normal n = (-ay,-ax,1)/den.
        f = -a / np.sqrt(denom)
        # First fundamental form E=1+(ay)^2, F=a^2 xy, G=1+(ax)^2
        E = 1.0 + (a * y) ** 2
        F = a * a * x * y
        G = 1.0 + (a * x) ** 2
        for i in range(n):
            I = np.array([[E[i], F[i]], [F[i], G[i]]])
            II = np.array([[0.0, f[i]], [f[i], 0.0]])
            shape = np.linalg.inv(I) @ II
            vals, vecs = np.linalg.eigh(shape)
            order = np.argsort(vals)[::-1]
            vals, vecs = vals[order], vecs[:, order]
            k1[i], k2[i] = vals
            # tangent basis: dx=(1,0,ay), dy=(0,1,ax)
            basis = np.array([[1.0, 0.0, a * y[i]],
                              [0.0, 1.0, a * x[i]]])
            d1[i] = vecs[0, 0] * basis[0] + vecs[1, 0] * basis[1]
            d2[i] = vecs[0, 1] * basis[0] + vecs[1, 1] * basis[1]
            d1[i] /= np.linalg.norm(d1[i])
            d2[i] /= np.linalg.norm(d2[i])
    elif name == "plane":
        pass  # k1 = k2 = 0; flat, no principal direction
    else:
        raise KeyError(name)
    return k1, k2, d1, d2


def _line_angle(est, gt):
    """Acute angle in degrees between unoriented tangent lines."""
    c = np.clip(np.abs(np.einsum("ij,ij->i", est, gt)), 0.0, 1.0)
    return np.degrees(np.arccos(c))


def curvature_errors(mesh, curv):
    k1, k2, _, _ = ground_truth(mesh)
    est = np.concatenate([curv.k1, curv.k2])
    true = np.concatenate([k1, k2])
    err = np.abs(est - true)
    return float(np.mean(err)), float(np.max(err))


def direction_errors(mesh, curv):
    """Median/p90/max angle error on confident vertices (d2 line field)."""
    _, _, _, d2_true = ground_truth(mesh)
    mask = curv.confident & (np.linalg.norm(d2_true, axis=1) > 0.5)
    if mask.sum() == 0:
        return float("nan"), float("nan"), float("nan"), mask
    angles = _line_angle(curv.d2[mask], d2_true[mask])
    return (float(np.median(angles)), float(np.percentile(angles, 90)),
            float(np.max(angles)), mask)


def attachment_residual(mesh, lines):
    """Max distance of the traced polylines from the exact analytic surface.

    Stored vertices and segment midpoints are both tested, capturing chord
    sag between integration points rather than endpoint error alone.
    """
    worst = 0.0
    for line in lines:
        pts = line.points
        tested = np.vstack([pts, 0.5 * (pts[:-1] + pts[1:])]) if len(pts) > 1 else pts
        snapped = mesh.project(tested)
        worst = max(worst, float(
            np.max(np.linalg.norm(snapped - tested, axis=1))))
    return worst


def length_stats(lines):
    if not lines:
        return dict(count=0, min=0.0, p25=0.0, median=0.0, p75=0.0,
                    p90=0.0, max=0.0, mean=0.0, total=0.0)
    lengths = np.array([ln.arc_length for ln in lines])
    return dict(
        count=float(len(lengths)),
        min=float(lengths.min()),
        p25=float(np.percentile(lengths, 25)),
        median=float(np.median(lengths)),
        p75=float(np.percentile(lengths, 75)),
        p90=float(np.percentile(lengths, 90)),
        max=float(lengths.max()),
        mean=float(lengths.mean()),
        total=float(lengths.sum()),
    )
