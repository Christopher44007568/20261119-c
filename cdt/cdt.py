"""High-level constrained Delaunay triangulation API."""

from .triangulation import Triangulation
from .geometry import segments_conflict, segments_properly_intersect


class SelfIntersectionError(ValueError):
    """Raised when the boundary or constraint segments conflict.

    `conflicts` is a list of ((p1, p2), (p3, p4)) coordinate pairs of the
    offending segments; nothing is triangulated silently.
    """

    def __init__(self, conflicts):
        self.conflicts = conflicts
        lines = ["self-intersecting input, conflicting segments:"]
        for s1, s2 in conflicts:
            lines.append(f"  {s1}  x  {s2}")
        super().__init__("\n".join(lines))


def find_conflicts(segments):
    """All pairs of segments that improperly intersect."""
    conflicts = []
    for i in range(len(segments)):
        for j in range(i + 1, len(segments)):
            (a, b), (c, d) = segments[i], segments[j]
            if segments_conflict(a, b, c, d):
                conflicts.append(((a, b), (c, d)))
    return conflicts


def _loop_segments(loop):
    return [(loop[i], loop[(i + 1) % len(loop)]) for i in range(len(loop))]


class ConstrainedDelaunay:
    """CDT of a polygonal domain with holes and internal constraints.

    outer:      CCW boundary loop (list of (x, y))
    holes:      list of inner loops (orientation does not matter)
    constraints: extra internal segments [(p, q), ...]
    points:     extra interior Steiner points
    """

    def __init__(self, outer, holes=None, constraints=None, points=None):
        self.outer = [tuple(map(float, p)) for p in outer]
        self.holes = [[tuple(map(float, p)) for p in h] for h in (holes or [])]
        self.constraints = [
            (tuple(map(float, a)), tuple(map(float, b)))
            for a, b in (constraints or [])
        ]
        self.extra_points = [tuple(map(float, p)) for p in (points or [])]
        self._validate()
        self.insertion_records = []
        self.constraint_records = []
        self._build()

    # ------------------------------------------------------------------ #
    def _validate(self):
        if len(self.outer) < 3:
            raise ValueError("outer boundary needs at least 3 vertices")
        boundary = _loop_segments(self.outer)
        for h in self.holes:
            if len(h) < 3:
                raise ValueError("hole needs at least 3 vertices")
            boundary += _loop_segments(h)
        # boundary edges must not conflict with each other at all
        conflicts = find_conflicts(boundary)
        # internal constraints may touch the boundary at their endpoints,
        # but must never properly cross any boundary or other constraint
        others = boundary + list(self.constraints)
        for i, seg in enumerate(self.constraints):
            for other in others[: len(boundary) + i + 1]:
                if other == seg:
                    continue
                if segments_properly_intersect(seg[0], seg[1],
                                               other[0], other[1]):
                    conflicts.append((seg, other))
        if conflicts:
            raise SelfIntersectionError(conflicts)

    # ------------------------------------------------------------------ #
    def _build(self):
        tri = Triangulation()
        all_pts = (
            self.outer
            + [p for h in self.holes for p in h]
            + [p for seg in self.constraints for p in seg]
            + self.extra_points
        )
        tri.init_supertriangle(all_pts)
        for p in all_pts:
            _, rec = tri.insert_point(p)
            self.insertion_records.append(rec)
        vid = {p: tri.add_point(p) for p in all_pts}
        segments = (
            _loop_segments(self.outer)
            + [s for h in self.holes for s in _loop_segments(h)]
            + list(self.constraints)
        )
        for a, b in segments:
            rec = tri.insert_constraint(vid[a], vid[b])
            self.constraint_records.append(rec)
        tri.remove_exterior(self.outer, self.holes)
        self.tri = tri

    # ------------------------------------------------------------------ #
    def insert_point(self, p):
        """Incrementally insert a vertex; returns the InsertionRecord so
        callers can inspect the local retriangulation (cavity, flips,
        circumcircles)."""
        p = tuple(map(float, p))
        try:
            vid, rec = self.tri.insert_point(p)
        except RuntimeError as exc:
            raise ValueError(f"point {p} outside triangulated domain") from exc
        self.insertion_records.append(rec)
        return vid, rec

    def export(self):
        """(points, triangles): coordinates and CCW index triples."""
        return self.tri.export()

    def constraint_segments(self):
        segs = (
            _loop_segments(self.outer)
            + [s for h in self.holes for s in _loop_segments(h)]
            + list(self.constraints)
        )
        return segs
