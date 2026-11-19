"""Post-build validation helpers: area conservation, empty holes,
constraint survival, and export sanity."""

from fractions import Fraction

from .geometry import polygon_area, point_in_polygon
from .predicates import orient2d


def triangle_area_sum(points, triangles):
    total = 0.0
    for a, b, c in triangles:
        pa, pb, pc = points[a], points[b], points[c]
        total += abs(
            (pb[0] - pa[0]) * (pc[1] - pa[1])
            - (pc[0] - pa[0]) * (pb[1] - pa[1])
        ) / 2.0
    return total


def domain_area(outer, holes):
    return polygon_area(outer) - sum(polygon_area(h) for h in holes)


def check_area_conservation(points, triangles, outer, holes, rtol=1e-9):
    """Sum of triangle areas must equal polygon area minus holes."""
    got = triangle_area_sum(points, triangles)
    want = domain_area(outer, holes)
    ok = abs(got - want) <= rtol * max(want, 1.0)
    return {"ok": ok, "triangle_area": got, "domain_area": want,
            "abs_err": abs(got - want)}


def check_holes_empty(points, triangles, holes):
    """Return list of triangle indices leaking into a hole (must be [])."""
    bad = []
    for i, (a, b, c) in enumerate(triangles):
        cx = (points[a][0] + points[b][0] + points[c][0]) / 3.0
        cy = (points[a][1] + points[b][1] + points[c][1]) / 3.0
        for h in holes:
            if point_in_polygon((cx, cy), h) == 1:
                bad.append(i)
                break
    return bad


def check_constraints_present(points, triangles, segments):
    """Every constraint segment must survive as a mesh edge.

    A segment may be subdivided by vertices lying exactly on it; in that
    case a chain of collinear mesh edges must cover it end to end.
    Returns the list of missing segments (must be [])."""
    edges = []
    for a, b, c in triangles:
        for e in ((a, b), (b, c), (c, a)):
            edges.append((points[e[0]], points[e[1]]))
    edge_set = {frozenset(e) for e in edges}
    index = {p: i for i, p in enumerate(points)}
    missing = []
    for p, q in segments:
        p, q = tuple(p), tuple(q)
        u, v = index[p], index[q]
        if frozenset((u, v)) in edge_set:
            continue
        if not _covered_by_edges(p, q, edges):
            missing.append((p, q))
    return missing


def _covered_by_edges(p, q, edges):
    """True if collinear mesh edges seamlessly cover segment p-q."""
    dx = Fraction(q[0]) - Fraction(p[0])
    dy = Fraction(q[1]) - Fraction(p[1])
    length2 = dx * dx + dy * dy
    intervals = []
    for a, b in edges:
        if orient2d(p, q, a) != 0 or orient2d(p, q, b) != 0:
            continue
        ta = ((Fraction(a[0]) - Fraction(p[0])) * dx
              + (Fraction(a[1]) - Fraction(p[1])) * dy) / length2
        tb = ((Fraction(b[0]) - Fraction(p[0])) * dx
              + (Fraction(b[1]) - Fraction(p[1])) * dy) / length2
        lo, hi = min(ta, tb), max(ta, tb)
        lo, hi = max(lo, Fraction(0)), min(hi, Fraction(1))
        if lo < hi:
            intervals.append((lo, hi))
    intervals.sort()
    covered = Fraction(0)
    for lo, hi in intervals:
        if lo > covered:
            return False
        covered = max(covered, hi)
        if covered >= 1:
            return True
    return covered >= 1


def check_export(points, triangles):
    """Sanity of exported indices: in range, CCW, non-degenerate."""
    problems = []
    for i, (a, b, c) in enumerate(triangles):
        if not (0 <= a < len(points) and 0 <= b < len(points)
                and 0 <= c < len(points)):
            problems.append((i, "index out of range"))
            continue
        pa, pb, pc = points[a], points[b], points[c]
        cross = ((pb[0] - pa[0]) * (pc[1] - pa[1])
                 - (pc[0] - pa[0]) * (pb[1] - pa[1]))
        if cross <= 0:
            problems.append((i, "not strictly CCW"))
    return problems
