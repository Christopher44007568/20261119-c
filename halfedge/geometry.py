"""Floating-point tolerant planar geometry primitives and segment splitting."""

from __future__ import annotations

import math
from dataclasses import dataclass

EPS = 1e-9
KEY_DECIMALS = 9


def vertex_key(x: float, y: float) -> tuple[float, float]:
    """Quantized coordinate used to identify coincident vertices."""
    return (round(x, KEY_DECIMALS), round(y, KEY_DECIMALS))


@dataclass(frozen=True)
class Point:
    x: float
    y: float

    @property
    def key(self) -> tuple[float, float]:
        return vertex_key(self.x, self.y)


@dataclass(frozen=True)
class Segment:
    a: Point
    b: Point
    source: int = -1


def cross(ax: float, ay: float, bx: float, by: float) -> float:
    return ax * by - ay * bx


def orient(a: Point, b: Point, c: Point) -> float:
    return cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y)


def in_bbox(a: Point, b: Point, p: Point) -> bool:
    return (
        min(a.x, b.x) - EPS <= p.x <= max(a.x, b.x) + EPS
        and min(a.y, b.y) - EPS <= p.y <= max(a.y, b.y) + EPS
    )


def on_segment(a: Point, b: Point, p: Point) -> bool:
    return abs(orient(a, b, p)) <= EPS and in_bbox(a, b, p)


def _point_at(a: Point, b: Point, t: float) -> Point:
    return Point(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y))


def _param(a: Point, b: Point, p: Point) -> float:
    dx, dy = b.x - a.x, b.y - a.y
    denom = dx * dx + dy * dy
    if denom <= EPS:
        return 0.0
    return ((p.x - a.x) * dx + (p.y - a.y) * dy) / denom


def segment_intersections(s1: Segment, s2: Segment) -> list[Point]:
    """Return all contact points / overlap endpoints between two segments."""
    a, b, c, d = s1.a, s1.b, s2.a, s2.b
    r = (b.x - a.x, b.y - a.y)
    s = (d.x - c.x, d.y - c.y)
    rxs = cross(r[0], r[1], s[0], s[1])
    qpx, qpy = c.x - a.x, c.y - a.y
    qpxr = cross(qpx, qpy, r[0], r[1])

    if abs(rxs) > EPS:
        t = cross(qpx, qpy, s[0], s[1]) / rxs
        u = qpxr / rxs
        if -EPS <= t <= 1.0 + EPS and -EPS <= u <= 1.0 + EPS:
            return [_point_at(a, b, min(1.0, max(0.0, t)))]
        return []

    # Parallel: collinear only if the area of (a, b, c) is zero.
    if abs(qpxr) > EPS:
        return []

    # Collinear: intersect by parameters along s1.
    t_c = _param(a, b, c)
    t_d = _param(a, b, d)
    lo, hi = sorted((t_c, t_d))
    lo = min(1.0, max(0.0, lo))
    hi = min(1.0, max(0.0, hi))
    if hi < lo - EPS:
        return []
    points = [_point_at(a, b, lo)]
    if hi - lo > EPS:
        points.append(_point_at(a, b, hi))
    return points


def split_segments(segments: list[Segment]) -> list[tuple[Point, Point, int]]:
    """Split every segment at every contact point.

    Returns atomic sub-segments ``(p, q, source_index)`` with distinct
    endpoints, covering overlaps exactly once per source segment.
    """
    cuts: list[list[Point]] = [[seg.a, seg.b] for seg in segments]
    for i, seg_i in enumerate(segments):
        for j in range(i + 1, len(segments)):
            for point in segment_intersections(seg_i, segments[j]):
                if on_segment(seg_i.a, seg_i.b, point):
                    cuts[i].append(point)
                if on_segment(segments[j].a, segments[j].b, point):
                    cuts[j].append(point)

    atomic: list[tuple[Point, Point, int]] = []
    for i, seg in enumerate(segments):
        ordered = sorted(
            cuts[i], key=lambda p: (_param(seg.a, seg.b, p), p.x, p.y)
        )
        unique: list[Point] = []
        for point in ordered:
            if not unique or point.key != unique[-1].key:
                unique.append(point)
        for p, q in zip(unique, unique[1:]):
            if math.hypot(q.x - p.x, q.y - p.y) > EPS:
                atomic.append((p, q, seg.source if seg.source >= 0 else i))
    return atomic
