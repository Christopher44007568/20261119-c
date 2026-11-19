"""Minimal pure-Python 3D vector helpers (no third-party dependencies).

Vectors are plain ``tuple`` of three floats.  Keeping the helpers tiny and
functional makes the geometry code easy to audit.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

Vec = tuple[float, float, float]


def add(a: Sequence[float], b: Sequence[float]) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Sequence[float], b: Sequence[float]) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a: Sequence[float], s: float) -> Vec:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: Sequence[float], b: Sequence[float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Sequence[float], b: Sequence[float]) -> Vec:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def norm(a: Sequence[float]) -> float:
    return math.sqrt(dot(a, a))


def normalize(a: Sequence[float]) -> Vec:
    n = norm(a)
    if n <= 1e-15:
        raise ZeroDivisionError("cannot normalize a zero-length vector")
    return (a[0] / n, a[1] / n, a[2] / n)


def safe_normalize(a: Sequence[float], tol: float = 1e-12):
    """Return unit vector or ``None`` when the input is (near) zero length."""
    n = norm(a)
    if n <= tol:
        return None
    return (a[0] / n, a[1] / n, a[2] / n)


def lerp(a: Sequence[float], b: Sequence[float], t: float) -> Vec:
    return (
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    )


def rotate(a: Sequence[float], axis: Sequence[float], angle: float) -> Vec:
    """Rotate vector ``a`` around unit ``axis`` by ``angle`` (Rodrigues)."""
    c, s = math.cos(angle), math.sin(angle)
    term1 = scale(a, c)
    term2 = scale(cross(axis, a), s)
    term3 = scale(axis, dot(axis, a) * (1.0 - c))
    return add(add(term1, term2), term3)


def angle_between(a: Sequence[float], b: Sequence[float]) -> float:
    """Unsigned angle in radians between two vectors, robust at the limits."""
    na, nb = norm(a), norm(b)
    if na <= 1e-15 or nb <= 1e-15:
        raise ZeroDivisionError("angle undefined for zero-length vector")
    cos_a = max(-1.0, min(1.0, dot(a, b) / (na * nb)))
    return math.acos(cos_a)


def mean(vectors: Iterable[Sequence[float]]) -> Vec:
    total = [0.0, 0.0, 0.0]
    count = 0
    for vec in vectors:
        for i in range(3):
            total[i] += vec[i]
        count += 1
    if count == 0:
        raise ValueError("mean of empty vector set")
    return (total[0] / count, total[1] / count, total[2] / count)
