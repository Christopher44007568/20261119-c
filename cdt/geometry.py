"""Basic computational-geometry primitives built on exact predicates."""

from .predicates import orient2d


def shoelace_signed(poly):
    """Signed area of a polygon (positive for CCW winding)."""
    area = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        area += x0 * y1 - x1 * y0
    return 0.5 * area


def polygon_area(poly):
    return abs(shoelace_signed(poly))


def _on_segment(a, b, p):
    """True if p is collinear with a-b and lies between them (inclusive)."""
    if orient2d(a, b, p) != 0:
        return False
    return (
        min(a[0], b[0]) <= p[0] <= max(a[0], b[0])
        and min(a[1], b[1]) <= p[1] <= max(a[1], b[1])
    )


def segments_properly_intersect(p1, p2, p3, p4):
    """True if the open segments cross at a single interior point."""
    o1 = orient2d(p1, p2, p3)
    o2 = orient2d(p1, p2, p4)
    o3 = orient2d(p3, p4, p1)
    o4 = orient2d(p3, p4, p2)
    return o1 * o2 < 0 and o3 * o4 < 0


def segments_conflict(p1, p2, p3, p4):
    """True if two segments improperly intersect: a proper crossing, a
    touching endpoint in the interior, or a collinear overlap."""
    if segments_properly_intersect(p1, p2, p3, p4):
        return True
    for p in (p3, p4):
        if p != p1 and p != p2 and _on_segment(p1, p2, p):
            return True
    for p in (p1, p2):
        if p != p3 and p != p4 and _on_segment(p3, p4, p):
            return True
    return False


def point_in_polygon(pt, poly):
    """Ray-casting test.  Returns 1 inside, 0 on boundary, -1 outside."""
    n = len(poly)
    x, y = pt
    inside = False
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        if _on_segment(a, b, pt):
            return 0
        if (a[1] > y) != (b[1] > y):
            xint = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if xint > x:
                inside = not inside
    return 1 if inside else -1


def circumcircle(pa, pb, pc):
    """Circumcircle of a triangle as ((cx, cy), r), or None if degenerate."""
    ax, ay = pa
    bx, by = pb
    cx, cy = pc
    d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if d == 0.0:
        return None
    a2 = ax * ax + ay * ay
    b2 = bx * bx + by * by
    c2 = cx * cx + cy * cy
    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    r = ((ux - ax) ** 2 + (uy - ay) ** 2) ** 0.5
    return (ux, uy), r
