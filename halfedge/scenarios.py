"""Reusable planar test scenarios."""

from .geometry import Point, Segment


def dangling_edges() -> list[Segment]:
    """Triangle with two dangling spurs attached to boundary vertices."""
    pts = [Point(0, 0), Point(4, 0), Point(2, 3)]
    segs = [Segment(pts[0], pts[1], 0), Segment(pts[1], pts[2], 1),
            Segment(pts[2], pts[0], 2)]
    segs.append(Segment(pts[0], Point(-1.5, -1.2), 3))
    segs.append(Segment(pts[1], Point(5.5, 1.0), 4))
    segs.append(Segment(Point(-1.5, -1.2), Point(-2.2, -0.4), 5))
    return segs


def t_junctions() -> list[Segment]:
    """Two vertical walls terminate on horizontal segments (T contacts)."""
    segs = [
        Segment(Point(0, 0), Point(6, 0), 0),
        Segment(Point(6, 0), Point(6, 4), 1),
        Segment(Point(6, 4), Point(0, 4), 2),
        Segment(Point(0, 4), Point(0, 0), 3),
        Segment(Point(2, 0), Point(2, 4), 4),
        Segment(Point(4, 2), Point(4, 4), 5),
    ]
    return segs


def collinear_overlap() -> list[Segment]:
    """Overlapping collinear inputs plus a crossing line."""
    segs = [
        Segment(Point(0, 2), Point(5, 2), 0),
        Segment(Point(2, 2), Point(7, 2), 1),
        Segment(Point(1, 0), Point(6, 4), 2),
        Segment(Point(1, 0), Point(1, 5), 3),
        Segment(Point(1, 5), Point(6, 4), 4),
    ]
    return segs


def multi_vertex_concurrency() -> list[Segment]:
    """Four lines meet at one common interior point."""
    center = Point(3, 3)
    segs = [
        Segment(Point(0, 3), Point(6, 3), 0),
        Segment(Point(3, 0), Point(3, 6), 1),
        Segment(Point(0, 0), Point(6, 6), 2),
        Segment(Point(0, 6), Point(6, 0), 3),
        Segment(Point(6, 0), Point(6, 6), 4),
    ]
    return segs


def base_rectangle_cells() -> list[Segment]:
    """Rectangle 4x3 split into three vertical cells."""
    return [
        Segment(Point(0, 0), Point(4, 0), 0),
        Segment(Point(4, 0), Point(4, 3), 1),
        Segment(Point(4, 3), Point(0, 3), 2),
        Segment(Point(0, 3), Point(0, 0), 3),
        Segment(Point(4 / 3, 0), Point(4 / 3, 3), 4),
        Segment(Point(8 / 3, 0), Point(8 / 3, 3), 5),
    ]


def cross_faces_line() -> Segment:
    """Diagonal segment crossing all three cells."""
    return Segment(Point(0.0, 0.5), Point(4.0, 2.0), 100)
