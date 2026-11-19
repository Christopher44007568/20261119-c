"""Parallel-transport (Bishop) frames along a sweep path.

A Frenet frame flips its normal whenever the path curvature changes sign or
vanishes on straight runs.  Parallel transport instead carries the previous
normal/binormal to each new tangent through the shortest rotation, which
introduces no artificial twist.  For closed paths the residual closure twist
is distributed evenly over every segment so the seam matches exactly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .vector import (
    Vec,
    angle_between,
    cross,
    dot,
    normalize,
    rotate,
    safe_normalize,
)


@dataclass
class Frame:
    """Orthonormal frame (tangent, normal, binormal) at one sample."""

    index: int
    position: Vec
    tangent: Vec
    normal: Vec
    binormal: Vec


def compute_tangents(points: list[Vec], closed: bool) -> list[Vec]:
    """Centered finite-difference tangents; one-sided at open ends."""
    n = len(points)
    tangents: list[Vec] = []
    for i in range(n):
        if closed:
            direction = (
                points[(i + 1) % n][0] - points[(i - 1) % n][0],
                points[(i + 1) % n][1] - points[(i - 1) % n][1],
                points[(i + 1) % n][2] - points[(i - 1) % n][2],
            )
        elif i == 0:
            direction = sub3(points[1], points[0])
        elif i == n - 1:
            direction = sub3(points[-1], points[-2])
        else:
            direction = sub3(points[i + 1], points[i - 1])
        tangents.append(normalize(direction))
    return tangents


def sub3(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def initial_normal(tangent: Vec) -> Vec:
    """Pick a stable unit normal perpendicular to the first tangent."""
    reference = (0.0, 0.0, 1.0)
    if abs(dot(tangent, reference)) > 0.9:
        reference = (1.0, 0.0, 0.0)
    return normalize(cross(tangent, reference))


def transport(normal: Vec, binormal: Vec, t0: Vec, t1: Vec) -> tuple[Vec, Vec]:
    """Rotate a frame from tangent ``t0`` to tangent ``t1`` minimally."""
    axis = safe_normalize(cross(t0, t1))
    if axis is None:
        # Parallel (or anti-parallel, which centered tangents cannot produce
        # for distinct points): keep the existing frame.
        return normal, binormal
    angle = angle_between(t0, t1)
    return rotate(normal, axis, angle), rotate(binormal, axis, angle)


def parallel_transport_frames(
    points: list[Vec], closed: bool
) -> tuple[list[Frame], float]:
    """Build frames and return them plus the closure twist (radians).

    The closure twist is zero for open paths; for closed paths it is the
    residual angle removed by the seam correction.
    """
    n = len(points)
    tangents = compute_tangents(points, closed)
    normal0 = initial_normal(tangents[0])
    binormal0 = normalize(cross(tangents[0], normal0))

    normals: list[Vec] = [normal0]
    binormals: list[Vec] = [binormal0]
    for i in range(1, n):
        nxt, bxt = transport(normals[-1], binormals[-1],
                              tangents[i - 1], tangents[i])
        # Re-orthogonalize against the tangent to fight numeric drift.
        nxt = safe_normalize(
            (
                nxt[0] - tangents[i][0] * dot(nxt, tangents[i]),
                nxt[1] - tangents[i][1] * dot(nxt, tangents[i]),
                nxt[2] - tangents[i][2] * dot(nxt, tangents[i]),
            )
        )
        assert nxt is not None
        bxt = normalize(cross(tangents[i], nxt))
        normals.append(nxt)
        binormals.append(bxt)

    closure_twist = 0.0
    if closed:
        # Transport the final frame back across the closing segment and
        # measure the signed mismatch against the initial frame.
        n_back, _ = transport(normals[-1], binormals[-1],
                              tangents[-1], tangents[0])
        projected = (
            n_back[0] - tangents[0][0] * dot(n_back, tangents[0]),
            n_back[1] - tangents[0][1] * dot(n_back, tangents[0]),
            n_back[2] - tangents[0][2] * dot(n_back, tangents[0]),
        )
        projected = normalize(projected)
        sign = dot(cross(normals[0], projected), tangents[0])
        closure_twist = angle_between(normals[0], projected)
        if sign < 0.0:
            closure_twist = -closure_twist
        # Distribute the compensating twist evenly along all segments.
        for i in range(n):
            theta = -closure_twist * i / n
            normals[i] = rotate(normals[i], tangents[i], theta)
            binormals[i] = normalize(cross(tangents[i], normals[i]))

    frames = [
        Frame(i, points[i], tangents[i], normals[i], binormals[i])
        for i in range(n)
    ]
    return frames, closure_twist


def frenet_normals(points: list[Vec], closed: bool) -> list[Vec | None]:
    """Reference Frenet normals, used to demonstrate flip instability.

    Returns ``None`` where curvature is too weak to define a normal.
    """
    tangents = compute_tangents(points, closed)
    out: list[Vec | None] = []
    n = len(points)
    for i in range(n):
        prev_t = tangents[(i - 1) % n] if closed or i > 0 else tangents[0]
        next_t = tangents[(i + 1) % n] if closed or i < n - 1 else tangents[-1]
        normal = safe_normalize(cross(prev_t, next_t))
        if normal is None:
            out.append(None)
        else:
            # Frenet normal lies along dT/ds (in the osculating plane).
            dn = safe_normalize(sub3(next_t, prev_t))
            out.append(dn)
    return out


def frame_orthogonality_error(frames: list[Frame]) -> float:
    """Max deviation from an orthonormal right-handed frame."""
    worst = 0.0
    for f in frames:
        worst = max(worst, abs(dot(f.tangent, f.normal)))
        worst = max(worst, abs(dot(f.tangent, f.binormal)))
        worst = max(worst, abs(dot(f.normal, f.binormal)))
        handed = cross(f.tangent, f.normal)
        worst = max(worst, max(abs(handed[k] - f.binormal[k]) for k in range(3)))
        for vec in (f.tangent, f.normal, f.binormal):
            worst = max(worst, abs(math.sqrt(dot(vec, vec)) - 1.0))
    return worst
