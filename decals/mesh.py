"""Receiver triangle mesh with vertex normals and slow-deform support."""

from .vec3 import add, cross, length, normalize, scale, sub


class TriangleMesh:
    def __init__(self, vertices, triangles):
        self.vertices = [tuple(map(float, v)) for v in vertices]
        self.triangles = [tuple(int(i) for i in t) for t in triangles]
        self._vertex_normals = None
        self._tri_normals = None

    def triangle_normal(self, ti):
        if self._tri_normals is None:
            self._tri_normals = [self._compute_tri_normal(t) for t in self.triangles]
        return self._tri_normals[ti]

    def _compute_tri_normal(self, tri):
        a, b, c = (self.vertices[i] for i in tri)
        return normalize(cross(sub(b, a), sub(c, a)))

    def triangle_area(self, ti):
        a, b, c = (self.vertices[i] for i in self.triangles[ti])
        return 0.5 * length(cross(sub(b, a), sub(c, a)))

    def vertex_normal(self, vi):
        if self._vertex_normals is None:
            accum = [(0.0, 0.0, 0.0)] * len(self.vertices)
            for ti, tri in enumerate(self.triangles):
                n = self.triangle_normal(ti)
                w = self.triangle_area(ti)
                for vi2 in tri:
                    accum[vi2] = add(accum[vi2], scale(n, w))
            self._vertex_normals = [normalize(n) for n in accum]
        return self._vertex_normals[vi]

    def deform(self, fn):
        """Slowly deform the receiver: fn(index, position) -> new position."""
        self.vertices = [fn(i, p) for i, p in enumerate(self.vertices)]
        self._vertex_normals = None
        self._tri_normals = None

    @staticmethod
    def grid(nx, ny, size=1.0, height_fn=None):
        """Triangulated grid on the XY plane (z up), centered at origin."""
        verts = []
        for j in range(ny + 1):
            for i in range(nx + 1):
                x = (i / nx - 0.5) * size
                y = (j / ny - 0.5) * size
                z = height_fn(x, y) if height_fn else 0.0
                verts.append((x, y, z))
        tris = []
        for j in range(ny):
            for i in range(nx):
                a = j * (nx + 1) + i
                b = a + 1
                c = a + nx + 1
                d = c + 1
                tris.append((a, b, d))
                tris.append((a, d, c))
        return TriangleMesh(verts, tris)
