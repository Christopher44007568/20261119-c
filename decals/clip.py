"""Sutherland-Hodgman clipping of triangles against the decal box.

Every polygon vertex carries its barycentric coordinates with respect to the
source receiver triangle, so clipped vertices stay attached to the surface
and can follow later deformation.
"""

_PLANES = tuple((axis, sign) for axis in range(3) for sign in (1.0, -1.0))


def _clip_plane(poly, half, axis, sign):
    out = []
    n = len(poly)
    for k in range(n):
        pos_a, bary_a = poly[k]
        pos_b, bary_b = poly[(k + 1) % n]
        da = sign * pos_a[axis] - half
        db = sign * pos_b[axis] - half
        in_a = da <= 1e-12
        in_b = db <= 1e-12
        if in_a:
            out.append((pos_a, bary_a))
        if in_a != in_b:
            t = da / (da - db)
            pos = tuple(pos_a[i] + (pos_b[i] - pos_a[i]) * t for i in range(3))
            bary = tuple(bary_a[i] + (bary_b[i] - bary_a[i]) * t for i in range(3))
            out.append((pos, bary))
    return out


def clip_triangle_to_box(local_tri, bary_tri, half_extents):
    """Clip one triangle (decal-local coords) to the projection box.

    Returns a list of fan-triangulated (local_pos, bary) triangles.
    """
    poly = list(zip(local_tri, bary_tri))
    for axis, sign in _PLANES:
        if not poly:
            return []
        poly = _clip_plane(poly, half_extents[axis], axis, sign)
    if len(poly) < 3:
        return []
    tris = []
    for k in range(1, len(poly) - 1):
        tris.append([poly[0], poly[k], poly[k + 1]])
    return tris
