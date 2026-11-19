"""Test suite for the CDT package.

Runnable directly (python3 tests/test_cdt.py) or under pytest.
"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cdt import ConstrainedDelaunay, SelfIntersectionError, validate


def _check_all(c):
    pts, tris = c.export()
    area = validate.check_area_conservation(pts, tris, c.outer, c.holes)
    assert area["ok"], f"area not conserved: {area}"
    assert validate.check_holes_empty(pts, tris, c.holes) == []
    missing = validate.check_constraints_present(
        pts, tris, c.constraint_segments())
    assert missing == [], f"missing constraints: {missing}"
    assert validate.check_export(pts, tris) == []
    return pts, tris


def test_concave_polygon():
    # arrow / dart shaped concave polygon
    outer = [(0, 0), (8, 0), (8, 3), (4, 1.5), (0, 3)]
    c = ConstrainedDelaunay(outer)
    pts, tris = _check_all(c)
    assert validate.domain_area(outer, []) > 0
    assert len(tris) >= 3


def test_star_polygon():
    # 5-point star outline (strongly concave)
    outer = []
    for i in range(10):
        r = 5.0 if i % 2 == 0 else 2.0
        a = math.pi / 2 + i * math.pi / 5
        outer.append((r * math.cos(a), r * math.sin(a)))
    c = ConstrainedDelaunay(outer, points=[(0, 0)])
    _check_all(c)


def test_narrow_corridor():
    # zigzag corridor 10 units long, 0.02 wide
    w = 0.02
    top, bot = [], []
    for i in range(11):
        x = float(i)
        y = 0.5 if i % 2 == 0 else -0.5
        top.append((x, y + w))
        bot.append((x, y - w))
    outer = bot + top[::-1]
    c = ConstrainedDelaunay(outer)
    pts, tris = _check_all(c)
    area = validate.check_area_conservation(pts, tris, outer, [])
    assert area["abs_err"] <= 1e-9 * area["domain_area"]


def test_nearly_collinear():
    # boundary with almost-collinear vertices (1e-9 perturbation)
    outer = [(0, 0), (3, 1e-9), (6, -1e-9), (10, 0),
             (10, 4), (5, 4 + 1e-9), (0, 4)]
    inner = [(2 + i * 1e-9, 2 + i * 1e-9) for i in range(5)]
    c = ConstrainedDelaunay(outer, points=inner)
    _check_all(c)


def test_exactly_collinear_boundary_points():
    # points exactly on a boundary edge: constraint must be subdivided
    outer = [(0, 0), (10, 0), (10, 10), (0, 10)]
    pts_on_edge = [(2, 0), (5, 0), (8, 0)]
    c = ConstrainedDelaunay(outer, points=pts_on_edge)
    _check_all(c)


def test_hole_is_empty():
    outer = [(0, 0), (12, 0), (12, 12), (0, 12)]
    hole = [(4, 4), (8, 4), (8, 8), (4, 8)]
    c = ConstrainedDelaunay(outer, holes=[hole],
                            points=[(1, 1), (10, 5), (5, 10)])
    pts, tris = _check_all(c)
    # no triangle vertex strictly inside the hole, either
    from cdt.geometry import point_in_polygon
    for t in tris:
        for v in t:
            assert point_in_polygon(pts[v], hole) != 1
    # area exactly outer minus hole
    assert abs(validate.triangle_area_sum(pts, tris)
               - (144.0 - 16.0)) < 1e-9


def test_multiple_holes_and_inner_constraint():
    outer = [(0, 0), (20, 0), (20, 10), (0, 10)]
    h1 = [(2, 2), (5, 2), (5, 5), (2, 5)]
    h2 = [(14, 3), (17, 3), (17, 7), (14, 7)]
    seg = [((5, 3), (14, 5))]  # bridge between the holes
    c = ConstrainedDelaunay(outer, holes=[h1, h2], constraints=seg,
                            points=[(10, 8), (10, 1)])
    _check_all(c)


def test_self_intersecting_boundary_rejected():
    bowtie = [(0, 0), (4, 4), (4, 0), (0, 4)]
    try:
        ConstrainedDelaunay(bowtie)
    except SelfIntersectionError as exc:
        assert len(exc.conflicts) == 1  # the two crossing diagonals
        for s1, s2 in exc.conflicts:
            assert len(s1) == 2 and len(s2) == 2
    else:
        raise AssertionError("self-intersection silently accepted")


def test_constraint_crossing_boundary_rejected():
    outer = [(0, 0), (10, 0), (10, 10), (0, 10)]
    bad = [((-5, 5), (5, 5))]  # crosses the left boundary edge
    try:
        ConstrainedDelaunay(outer, constraints=bad)
    except SelfIntersectionError as exc:
        assert exc.conflicts
    else:
        raise AssertionError("crossing constraint silently accepted")


def test_export_indices_and_constraint_survival():
    outer = [(0, 0), (6, 0), (6, 6), (0, 6)]
    seg = [((1, 1), (5, 2)), ((5, 2), (3, 5))]
    c = ConstrainedDelaunay(outer, constraints=seg,
                            points=[(2, 4), (4, 4)])
    pts, tris = _check_all(c)
    index = {p: i for i, p in enumerate(pts)}
    edge_set = set()
    for a, b, cc in tris:
        for e in ((a, b), (b, cc), (cc, a)):
            edge_set.add(frozenset(e))
    for p, q in seg:
        assert frozenset((index[p], index[q])) in edge_set


def test_incremental_insertion_record():
    outer = [(0, 0), (10, 0), (10, 10), (0, 10)]
    c = ConstrainedDelaunay(outer, points=[(2, 2), (8, 2), (5, 8)])
    vid, rec = c.insert_point((5, 5))
    assert rec.vid == vid
    assert rec.cavity, "record must contain the retriangulated cavity"
    assert rec.new_triangles, "record must contain new triangles"
    assert len(rec.circumcircles) == len(rec.new_triangles)
    for (center, r) in rec.circumcircles:
        assert r > 0
    _check_all(c)
    # flips are recorded as ((u, v), (c, d)) pairs when they occur
    for old, new in rec.flips:
        assert len(old) == 2 and len(new) == 2


def test_duplicate_point_ignored():
    outer = [(0, 0), (10, 0), (10, 10), (0, 10)]
    c = ConstrainedDelaunay(outer, points=[(5, 5)])
    n_before = len(c.export()[1])
    c.insert_point((5, 5))
    assert len(c.export()[1]) == n_before


def test_spiral_polygon():
    # extremely concave spiral with narrow arms
    spiral = []
    n = 40
    for i in range(n):
        r = 1.0 + 9.0 * i / n
        a = 3.0 * math.pi * i / n
        spiral.append((r * math.cos(a), r * math.sin(a)))
    for i in range(n, -1, -1):
        r = 0.6 + 9.0 * i / n
        a = 3.0 * math.pi * i / n
        spiral.append((r * math.cos(a), r * math.sin(a)))
    c = ConstrainedDelaunay(spiral)
    _check_all(c)


def test_x_monotone_constraint_chain():
    import random
    random.seed(7)
    xs = sorted(random.uniform(1, 9) for _ in range(10))
    poly = [(x, random.uniform(2, 8)) for x in xs]
    segs = [(poly[i], poly[i + 1]) for i in range(len(poly) - 1)]
    outer = [(0, 0), (10, 0), (10, 10), (0, 10)]
    c = ConstrainedDelaunay(outer, constraints=segs,
                            points=[(5, 5), (2, 8), (8, 2)])
    _check_all(c)


def test_cocircular_grid_points():
    # integer grid: exactly cocircular quadruples, must not hang or flip
    grid = [(float(i), float(j)) for i in range(6) for j in range(6)
            if 0 < i < 5 and 0 < j < 5]
    outer = [(0, 0), (5, 0), (5, 5), (0, 5)]
    c = ConstrainedDelaunay(outer, points=grid)
    _check_all(c)


def test_delaunay_property_random():
    import random
    from cdt.predicates import incircle
    random.seed(42)
    outer = [(0, 0), (10, 0), (10, 10), (0, 10)]
    hole = [(4, 4), (6, 4), (6, 6), (4, 6)]
    pts_in = [(random.uniform(0.5, 9.5), random.uniform(0.5, 9.5))
              for _ in range(60)]
    pts_in = [p for p in pts_in
              if not (4 < p[0] < 6 and 4 < p[1] < 6)]
    c = ConstrainedDelaunay(outer, holes=[hole], points=pts_in)
    pts, tris = _check_all(c)
    edge_owner = {}
    for t in tris:
        for i in range(3):
            e = frozenset((t[(i + 1) % 3], t[(i + 2) % 3]))
            edge_owner.setdefault(e, []).append(t)
    for e, owners in edge_owner.items():
        if len(owners) != 2 or e in c.tri.constrained:
            continue
        opp = [v for v in owners[1] if v not in e][0]
        a, b, cc = owners[0]
        assert incircle(pts[a], pts[b], pts[cc], pts[opp]) <= 0


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {fn.__name__}: {exc}")
    print(f"{len(fns) - failed}/{len(fns)} tests passed")
    sys.exit(1 if failed else 0)
