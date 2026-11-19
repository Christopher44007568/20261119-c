"""Triangle mesh construction and adjacency utilities.

All test surfaces are analytic parametric surfaces sampled on structured
grids and triangulated, so every generated mesh also knows how to project
points back onto its exact surface (used to measure attachment residual).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Mesh:
    name: str
    vertices: np.ndarray          # (V, 3)
    faces: np.ndarray             # (F, 3) int
    normals: np.ndarray           # (V, 3) vertex normals
    face_normals: np.ndarray      # (F, 3)
    face_areas: np.ndarray        # (F,)
    edge_faces: dict              # (sorted vertex pair) -> list of face ids
    face_adj: np.ndarray          # (F, 3) neighbour face across edge opposite local vertex; -1 = boundary
    boundary_edges: np.ndarray    # (B, 2)
    mean_edge: float
    project: object               # callable (N,3)->(N,3) exact surface projection

    @property
    def n_vertices(self) -> int:
        return self.vertices.shape[0]

    @property
    def n_faces(self) -> int:
        return self.faces.shape[0]


def _build_adjacency(faces: np.ndarray, n_vertices: int):
    edge_faces: dict[tuple[int, int], list[int]] = {}
    for fidx, tri in enumerate(faces):
        for k in range(3):
            a, b = int(tri[k]), int(tri[(k + 1) % 3])
            key = (a, b) if a < b else (b, a)
            edge_faces.setdefault(key, []).append(fidx)
    face_adj = -np.ones((len(faces), 3), dtype=np.int64)
    boundary = []
    for (a, b), fids in edge_faces.items():
        if len(fids) == 1:
            boundary.append((a, b))
            continue
        f0, f1 = fids
        tri0, tri1 = faces[f0], faces[f1]
        for tri, fown, fother in ((tri0, f0, f1), (tri1, f1, f0)):
            for k in range(3):
                ea, eb = int(tri[k]), int(tri[(k + 1) % 3])
                if min(ea, eb) == a and max(ea, eb) == b:
                    # edge k is opposite local vertex (k+2) % 3
                    face_adj[fown, (k + 2) % 3] = fother
    return edge_faces, face_adj, np.asarray(boundary, dtype=np.int64)


def _finalize(name: str, vertices: np.ndarray, faces: np.ndarray, project) -> Mesh:
    vertices = np.asarray(vertices, dtype=np.float64)
    faces = np.asarray(faces, dtype=np.int64)
    tri = vertices[faces]
    cross = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    face_normals = cross / np.linalg.norm(cross, axis=1, keepdims=True)
    face_areas = 0.5 * np.linalg.norm(cross, axis=1)
    normals = np.zeros_like(vertices)
    np.add.at(normals, faces[:, 0], face_normals * face_areas[:, None])
    np.add.at(normals, faces[:, 1], face_normals * face_areas[:, None])
    np.add.at(normals, faces[:, 2], face_normals * face_areas[:, None])
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    edge_faces, face_adj, boundary_edges = _build_adjacency(faces, len(vertices))
    all_edges = np.asarray(list(edge_faces.keys()), dtype=np.int64)
    mean_edge = float(
        np.mean(np.linalg.norm(vertices[all_edges[:, 0]] - vertices[all_edges[:, 1]], axis=1))
    )
    return Mesh(
        name=name,
        vertices=vertices,
        faces=faces,
        normals=normals,
        face_normals=face_normals,
        face_areas=face_areas,
        edge_faces=edge_faces,
        face_adj=face_adj,
        boundary_edges=boundary_edges,
        mean_edge=mean_edge,
        project=project,
    )


def _grid_faces(nu: int, nv: int, wrap_u: bool = False) -> np.ndarray:
    """Triangles for a (nu x nv) vertex grid; u may wrap periodically."""
    u_count = nu if wrap_u else nu - 1
    faces = []
    for j in range(nv - 1):
        for i in range(u_count):
            ip = (i + 1) % nu
            a = j * nu + i
            b = j * nu + ip
            c = (j + 1) * nu + i
            d = (j + 1) * nu + ip
            faces.append((a, c, d))
            faces.append((a, d, b))
    return np.asarray(faces, dtype=np.int64)


def make_cylinder(radius: float = 1.0, height: float = 2.0,
                  n_theta: int = 48, n_z: int = 32) -> Mesh:
    theta = np.linspace(0.0, 2.0 * np.pi, n_theta, endpoint=False)
    z = np.linspace(-height / 2, height / 2, n_z)
    th, zz = np.meshgrid(theta, z)
    vertices = np.column_stack([
        radius * np.cos(th.ravel()),
        radius * np.sin(th.ravel()),
        zz.ravel(),
    ])
    faces = _grid_faces(n_theta, n_z, wrap_u=True)

    def project(p: np.ndarray) -> np.ndarray:
        p = np.asarray(p, dtype=np.float64).copy()
        r = np.hypot(p[:, 0], p[:, 1])
        scale = radius / np.maximum(r, 1e-12)
        p[:, 0] *= scale
        p[:, 1] *= scale
        p[:, 2] = np.clip(p[:, 2], -height / 2, height / 2)
        return p

    return _finalize("cylinder", vertices, faces, project)


def make_sphere(radius: float = 1.0, n_lon: int = 64, n_lat: int = 32) -> Mesh:
    verts = [(0.0, 0.0, radius)]
    for j in range(1, n_lat):
        phi = np.pi * j / n_lat
        for i in range(n_lon):
            theta = 2.0 * np.pi * i / n_lon
            verts.append((
                radius * np.sin(phi) * np.cos(theta),
                radius * np.sin(phi) * np.sin(theta),
                radius * np.cos(phi),
            ))
    south = len(verts)
    verts.append((0.0, 0.0, -radius))
    vertices = np.asarray(verts, dtype=np.float64)
    ring = n_lon
    faces = []
    for i in range(n_lon):
        ip = (i + 1) % n_lon
        faces.append((0, 1 + ip, 1 + i))
    for j in range(n_lat - 2):
        r0 = 1 + j * ring
        r1 = r0 + ring
        for i in range(n_lon):
            ip = (i + 1) % n_lon
            faces.append((r0 + i, r0 + ip, r1 + ip))
            faces.append((r0 + i, r1 + ip, r1 + i))
    last_ring = 1 + (n_lat - 2) * ring
    for i in range(n_lon):
        ip = (i + 1) % n_lon
        faces.append((last_ring + i, last_ring + ip, south))

    def project(p: np.ndarray) -> np.ndarray:
        p = np.asarray(p, dtype=np.float64)
        return radius * p / np.linalg.norm(p, axis=1, keepdims=True)

    return _finalize("sphere", vertices, np.asarray(faces, dtype=np.int64), project)


def make_saddle(extent: float = 1.2, n: int = 48, a: float = 0.6) -> Mesh:
    """Hyperbolic paraboloid z = a*x*y on a regular (n x n) grid."""
    xs = np.linspace(-extent, extent, n)
    xx, yy = np.meshgrid(xs, xs)
    vertices = np.column_stack([xx.ravel(), yy.ravel(), (a * xx * yy).ravel()])
    faces = _grid_faces(n, n, wrap_u=False)

    def project(p: np.ndarray) -> np.ndarray:
        p = np.asarray(p, dtype=np.float64).copy()
        p[:, 2] = a * p[:, 0] * p[:, 1]
        return p

    return _finalize("saddle", vertices, faces, project)


def make_plane(extent: float = 1.0, n: int = 32) -> Mesh:
    """Flat z = 0 patch on a regular (n x n) grid."""
    xs = np.linspace(-extent, extent, n)
    xx, yy = np.meshgrid(xs, xs)
    vertices = np.column_stack([xx.ravel(), yy.ravel(), np.zeros(xx.size)])
    faces = _grid_faces(n, n, wrap_u=False)

    def project(p: np.ndarray) -> np.ndarray:
        p = np.asarray(p, dtype=np.float64).copy()
        p[:, 2] = 0.0
        return p

    return _finalize("plane", vertices, faces, project)


def make_mesh(name: str) -> Mesh:
    factories = {
        "cylinder": make_cylinder,
        "sphere": make_sphere,
        "saddle": make_saddle,
        "plane": make_plane,
    }
    if name not in factories:
        raise KeyError(f"unknown surface {name!r}")
    return factories[name]()
