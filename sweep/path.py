"""Sweep paths: sampled polylines with zero-length segment handling.

Paths arrive as ordered 3D sample points.  Consecutive duplicates (which
occur naturally when a straight segment is concatenated to an arc, or when
samplers emit shared junction points) form *zero-length segments*.  They
cannot define a tangent/frame, so they are merged and every removed sample
is reported instead of silently dropped.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .vector import Vec, norm, sub


class PathError(ValueError):
    """Raised when a path cannot be made sweepable."""


@dataclass
class MergeReport:
    """Record of zero-length segment merging."""

    removed: list[int] = field(default_factory=list)
    duplicates: list[tuple[int, Vec]] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.removed)

    def summary(self) -> str:
        if not self.removed:
            return "no zero-length segments"
        joined = ", ".join(str(i) for i in self.removed)
        return f"merged {self.count} zero-length segment(s) at index/indices {joined}"


@dataclass
class Path:
    """An ordered polyline, optionally closed.

    Attributes:
        points: retained sample points after merging.
        closed: whether the last point connects back to the first.
        merge_report: what was removed during cleaning.
    """

    points: list[Vec]
    closed: bool = False
    merge_report: MergeReport = field(default_factory=MergeReport)

    @classmethod
    def from_samples(
        cls, samples: list[Vec], closed: bool = False, tol: float = 1e-10
    ) -> "Path":
        if len(samples) < 2:
            raise PathError("path needs at least two sample points")
        report = MergeReport()
        cleaned: list[Vec] = [samples[0]]
        for index in range(1, len(samples)):
            point = samples[index]
            if norm(sub(point, cleaned[-1])) <= tol:
                report.removed.append(index)
                report.duplicates.append((index, point))
            else:
                cleaned.append(point)
        # A closed path may end on the start point: that duplicate is kept
        # conceptually by `closed=True`, so merge it too.
        if closed and len(cleaned) > 1 and norm(sub(cleaned[-1], cleaned[0])) <= tol:
            if len(samples) - 1 not in report.removed:
                report.removed.append(len(samples) - 1)
            report.duplicates.append((len(samples) - 1, cleaned[-1]))
            cleaned.pop()
        if len(cleaned) < 2:
            raise PathError("path collapsed to a single point after merging")
        return cls(cleaned, closed, report)

    def segment_lengths(self) -> list[float]:
        pts = self.points
        lengths = [norm(sub(pts[i + 1], pts[i])) for i in range(len(pts) - 1)]
        if self.closed:
            lengths.append(norm(sub(pts[0], pts[-1])))
        return lengths

    def total_length(self) -> float:
        return sum(self.segment_lengths())

    # ---- sample generators for the benchmark scenarios ----

    @staticmethod
    def s_curve(samples: int = 121) -> "Path":
        """Planar S-curve whose curvature changes sign.

        The Frenet normal reverses at the inflection while parallel transport
        stays continuous, which is exactly the flip problem the modeler
        avoids.
        """
        pts = []
        for i in range(samples):
            t = 4.0 * math.pi * i / (samples - 1)
            pts.append((4.0 * t / (4.0 * math.pi) - 2.0,
                        1.5 * math.sin(t), 0.0))
        return Path.from_samples(pts, closed=False)

    @staticmethod
    def helix(
        turns: float = 2.0,
        radius: float = 2.0,
        pitch: float = 1.5,
        samples: int = 121,
    ) -> "Path":
        pts = []
        for i in range(samples):
            t = 2.0 * math.pi * turns * i / (samples - 1)
            pts.append(
                (
                    radius * math.cos(t),
                    radius * math.sin(t),
                    pitch * t / (2.0 * math.pi),
                )
            )
        return Path.from_samples(pts, closed=False)

    @staticmethod
    def straight_bend_straight(
        straight: float = 3.0,
        bend_radius: float = 1.5,
        bend_angle: float = math.pi / 2.0,
        straight_samples: int = 16,
        bend_samples: int = 31,
        duplicate_junction: bool = True,
    ) -> "Path":
        """Line -> circular bend -> line, sharing junction points on purpose.

        The duplicated junction samples create zero-length segments that the
        cleaner must merge and report.
        """
        pts: list[Vec] = [(0.0, 0.0, 0.0)]
        # First straight run along +X.
        for i in range(1, straight_samples):
            pts.append((straight * i / (straight_samples - 1), 0.0, 0.0))
        center = (straight, bend_radius, 0.0)
        start_bend = (straight, 0.0, 0.0)
        if duplicate_junction:
            pts.append(start_bend)  # explicit zero-length segment
        # Circular arc starting at the bottom of the circle and travelling
        # counter-clockwise, so its entry tangent is +X (no cusp).
        for i in range(1, bend_samples):
            phi = -math.pi / 2.0 + bend_angle * i / (bend_samples - 1)
            pts.append(
                (
                    center[0] + bend_radius * math.cos(phi),
                    center[1] + bend_radius * math.sin(phi),
                    0.0,
                )
            )
        end_bend = pts[-1]
        if duplicate_junction:
            pts.append(end_bend)  # second explicit zero-length segment
        # Second straight run, tangent to the arc end.
        # Exit tangent of the CCW arc at phi = -pi/2 + angle.
        phi_end = -math.pi / 2.0 + bend_angle
        direction = (-math.sin(phi_end), math.cos(phi_end), 0.0)
        for i in range(1, straight_samples):
            f = straight * i / (straight_samples - 1)
            pts.append(
                (
                    end_bend[0] + direction[0] * f,
                    end_bend[1] + direction[1] * f,
                    0.0,
                )
            )
        return Path.from_samples(pts, closed=False)

    @staticmethod
    def closed_polygon(radius: float = 2.5, corners: int = 5,
                       per_side: int = 12) -> "Path":
        """A closed polygon in the XY plane.

        Corner anchors are emitted as explicit samples so the closing seam
        lands exactly on a shared vertex (its two half-edges then define a
        consistent centered tangent).
        """
        anchors = [
            (
                radius * math.cos(2.0 * math.pi * k / corners + math.pi / 2.0),
                radius * math.sin(2.0 * math.pi * k / corners + math.pi / 2.0),
                0.0,
            )
            for k in range(corners)
        ]
        pts: list[Vec] = []
        for k in range(corners):
            a0, a1 = anchors[k], anchors[(k + 1) % corners]
            for i in range(per_side):
                t = i / (per_side - 1)
                pts.append(
                    (
                        a0[0] + (a1[0] - a0[0]) * t,
                        a0[1] + (a1[1] - a0[1]) * t,
                        0.0,
                    )
                )
        # Explicit closure point equal to the first sample.
        pts.append(anchors[0])
        return Path.from_samples(pts, closed=True)
