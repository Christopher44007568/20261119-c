"""轴对齐包围盒（AABB）。"""

from __future__ import annotations

from math import inf

from .vec import Vec3


class AABB:
    __slots__ = ("lo", "hi")

    def __init__(self, lo: Vec3, hi: Vec3):
        self.lo: Vec3 = tuple(float(v) for v in lo)
        self.hi: Vec3 = tuple(float(v) for v in hi)

    @classmethod
    def empty(cls) -> "AABB":
        return cls((inf, inf, inf), (-inf, -inf, -inf))

    @classmethod
    def from_points(cls, points) -> "AABB":
        box = cls.empty()
        for p in points:
            box.include(p)
        return box

    def is_empty(self) -> bool:
        return any(self.hi[i] < self.lo[i] for i in range(3))

    def include(self, p: Vec3) -> None:
        self.lo = tuple(min(self.lo[i], p[i]) for i in range(3))
        self.hi = tuple(max(self.hi[i], p[i]) for i in range(3))

    def union(self, other: "AABB") -> "AABB":
        if other.is_empty():
            return AABB(self.lo, self.hi)
        if self.is_empty():
            return AABB(other.lo, other.hi)
        return AABB(
            tuple(min(self.lo[i], other.lo[i]) for i in range(3)),
            tuple(max(self.hi[i], other.hi[i]) for i in range(3)),
        )

    def center(self) -> Vec3:
        return tuple(0.5 * (self.lo[i] + self.hi[i]) for i in range(3))

    def extents(self) -> Vec3:
        if self.is_empty():
            return (0.0, 0.0, 0.0)
        return tuple(self.hi[i] - self.lo[i] for i in range(3))

    def surface_area(self) -> float:
        """表面积；空盒与无限退化盒返回 0。"""
        if self.is_empty():
            return 0.0
        e = self.extents()
        if any(v == inf for v in self.hi):
            return inf
        return 2.0 * (e[0] * e[1] + e[1] * e[2] + e[2] * e[0])

    def longest_axis(self) -> int:
        e = self.extents()
        return max(range(3), key=lambda i: e[i])

    def to_dict(self) -> dict:
        return {"lo": list(self.lo), "hi": list(self.hi)}

    def __repr__(self) -> str:
        return f"AABB(lo={self.lo}, hi={self.hi})"
