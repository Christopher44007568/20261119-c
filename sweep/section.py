"""Two-dimensional closed cross-sections with size constraints.

A section is a simple closed polygon stored in counter-clockwise (CCW)
order.  The module enforces two kinds of *size constraint*:

1. The polygon itself must be non-degenerate (positive area, bounded size).
2. Per-sample scale factors must be strictly positive and are checked
   against an optional maximum overall tube dimension.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


class SectionError(ValueError):
    """Raised when a cross-section violates a size/validity constraint."""


Point2 = tuple[float, float]


def polygon_area(points: list[Point2]) -> float:
    """Signed shoelace area; positive for CCW winding."""
    total = 0.0
    count = len(points)
    for i in range(count):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % count]
        total += x1 * y2 - x2 * y1
    return 0.5 * total


def polygon_perimeter(points: list[Point2]) -> float:
    total = 0.0
    count = len(points)
    for i in range(count):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % count]
        total += math.hypot(x2 - x1, y2 - y1)
    return total


@dataclass(frozen=True)
class Section:
    """A closed 2D section, always stored in CCW order."""

    points: tuple[Point2, ...]
    name: str = "section"

    def __post_init__(self) -> None:
        if len(self.points) < 3:
            raise SectionError("section needs at least 3 vertices")
        area = polygon_area(list(self.points))
        if abs(area) < 1e-12:
            raise SectionError("section has zero area (degenerate polygon)")
        if area < 0.0:
            object.__setattr__(self, "points", tuple(reversed(self.points)))
        if any(
            math.hypot(
                self.points[i][0] - self.points[j][0],
                self.points[i][1] - self.points[j][1],
            )
            < 1e-12
            for i in range(len(self.points))
            for j in range(i + 1, len(self.points))
        ):
            raise SectionError("section contains duplicate vertices")

    @property
    def area(self) -> float:
        return abs(polygon_area(list(self.points)))

    @property
    def perimeter(self) -> float:
        return polygon_perimeter(list(self.points))

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        xs = [p[0] for p in self.points]
        ys = [p[1] for p in self.points]
        return (min(xs), min(ys), max(xs), max(ys))

    @property
    def max_dimension(self) -> float:
        xmin, ymin, xmax, ymax = self.bbox
        return max(xmax - xmin, ymax - ymin)

    def scaled(self, factor: float, max_dimension: float | None = None) -> list[Point2]:
        """Return the polygon scaled by ``factor`` with constraint checks."""
        if not math.isfinite(factor):
            raise SectionError("scale factor must be finite")
        if factor <= 0.0:
            raise SectionError(
                f"scale factor must be strictly positive, got {factor}"
            )
        if max_dimension is not None:
            if factor * self.max_dimension > max_dimension + 1e-12:
                raise SectionError(
                    "scaled section exceeds size constraint: "
                    f"{factor * self.max_dimension:.6g} > {max_dimension:.6g}"
                )
        return [(p[0] * factor, p[1] * factor) for p in self.points]


def circle_section(radius: float, segments: int = 24, name: str = "circle") -> Section:
    if radius <= 0.0:
        raise SectionError("radius must be positive")
    if segments < 3:
        raise SectionError("circle needs at least 3 segments")
    points = [
        (
            radius * math.cos(2.0 * math.pi * i / segments),
            radius * math.sin(2.0 * math.pi * i / segments),
        )
        for i in range(segments)
    ]
    return Section(tuple(points), name)


def regular_polygon_section(
    radius: float, sides: int = 4, phase: float = math.pi / 4.0,
    name: str = "polygon",
) -> Section:
    if radius <= 0.0 or sides < 3:
        raise SectionError("radius must be positive and sides >= 3")
    points = [
        (
            radius * math.cos(phase + 2.0 * math.pi * i / sides),
            radius * math.sin(phase + 2.0 * math.pi * i / sides),
        )
        for i in range(sides)
    ]
    return Section(tuple(points), name)


def rectangle_section(
    width: float, height: float, name: str = "rectangle"
) -> Section:
    if width <= 0.0 or height <= 0.0:
        raise SectionError("width and height must be positive")
    hw, hh = width / 2.0, height / 2.0
    points = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    return Section(tuple(points), name)
