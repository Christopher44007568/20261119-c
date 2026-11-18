"""Simple triangle meshes: unit cube and ground plane."""


def cube_triangles():
    """Unit cube centered at origin, side length 1.

    Returns list of (v0, v1, v2, normal) with vertices as (x, y, z).
    """
    p = {
        "000": (-0.5, -0.5, -0.5), "001": (-0.5, -0.5, 0.5),
        "010": (-0.5, 0.5, -0.5), "011": (-0.5, 0.5, 0.5),
        "100": (0.5, -0.5, -0.5), "101": (0.5, -0.5, 0.5),
        "110": (0.5, 0.5, -0.5), "111": (0.5, 0.5, 0.5),
    }
    faces = [
        # (normal, quad corners CCW seen from outside)
        ((1, 0, 0), ("100", "101", "111", "110")),
        ((-1, 0, 0), ("000", "010", "011", "001")),
        ((0, 1, 0), ("010", "110", "111", "011")),
        ((0, -1, 0), ("000", "001", "101", "100")),
        ((0, 0, 1), ("001", "011", "111", "101")),
        ((0, 0, -1), ("000", "100", "110", "010")),
    ]
    tris = []
    for n, (a, b, c, d) in faces:
        n = tuple(float(v) for v in n)
        tris.append((p[a], p[b], p[c], n))
        tris.append((p[a], p[c], p[d], n))
    return tris


def plane_triangles(half_size=20.0, tiles=16):
    """Horizontal plane at y=0, tessellated so no single triangle spans
    behind the camera (the demo rasterizer skips rather than clips)."""
    n = (0.0, 1.0, 0.0)
    tris = []
    step = 2.0 * half_size / tiles
    for i in range(tiles):
        for j in range(tiles):
            x0 = -half_size + i * step
            z0 = -half_size + j * step
            x1 = x0 + step
            z1 = z0 + step
            a = (x0, 0.0, z0)
            b = (x1, 0.0, z0)
            c = (x1, 0.0, z1)
            d = (x0, 0.0, z1)
            tris.append((a, b, c, n))
            tris.append((a, c, d, n))
    return tris
