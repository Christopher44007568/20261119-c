"""Direction field with a stable fallback for flat / near-umbilic regions.

Confident vertices carry the analytically-estimated minimum-curvature
principal direction.  Vertices where |k1 - k2| is too small (planar patches
and umbilic points, e.g. a whole plane or a whole sphere) have no preferred
direction; there we grow a smooth tangent vector field by parallel transport
from confident boundary seeds, or from a deterministic global reference when
no confident seed exists at all (fully flat case).

Directions are transported through the mesh rather than projected in world
space, so the fallback field stays coherent and has no arbitrary jumps.
"""

from __future__ import annotations

from collections import deque

import numpy as np


def _project_tangent(vec: np.ndarray, normal: np.ndarray) -> np.ndarray:
    out = vec - normal * (vec @ normal)
    norm = np.linalg.norm(out)
    return out / norm if norm > 1e-10 else None


def build_fallback_field(mesh, curv):
    """Return (direction (V,3), source (V,) str) parallel-transport field."""
    n = mesh.n_vertices
    directions = np.zeros((n, 3))
    source = np.array(["unset"] * n, dtype="<U10")
    directions[curv.confident] = curv.d2[curv.confident]
    source[curv.confident] = "principal"

    # Vertex-vertex adjacency from faces.
    vv = [set() for _ in range(n)]
    for tri in mesh.faces:
        for a in range(3):
            for b in range(a + 1, 3):
                x, y = int(tri[a]), int(tri[b])
                vv[x].add(y)
                vv[y].add(x)

    queue = deque(int(i) for i in np.flatnonzero(curv.confident))
    visited = set(queue)
    while queue:
        i = queue.popleft()
        for j in vv[i]:
            if j in visited:
                continue
            transported = _project_tangent(directions[i], mesh.normals[j])
            if transported is None:
                continue
            directions[j] = transported
            source[j] = "transport"
            visited.add(j)
            queue.append(j)

    # Fully degenerate component (no confident seed anywhere): seed from a
    # fixed object-space reference vector and BFS-transport it.
    if len(visited) < n:
        ref = np.array([0.0, 1.0, 0.0])
        for root in range(n):
            if root in visited:
                continue
            seed = _project_tangent(ref, mesh.normals[root])
            if seed is None:
                seed = _project_tangent(np.array([1.0, 0.0, 0.0]),
                                        mesh.normals[root])
            directions[root] = seed
            source[root] = "reference"
            visited.add(root)
            local_queue = deque([root])
            while local_queue:
                i = local_queue.popleft()
                for j in vv[i]:
                    if j in visited:
                        continue
                    transported = _project_tangent(directions[i], mesh.normals[j])
                    if transported is None:
                        continue
                    directions[j] = transported
                    source[j] = "reference"
                    visited.add(j)
                    local_queue.append(j)
    return directions, source


def face_vertex_coordinates(mesh):
    """Barycentric helpers: per face, for each local vertex the (origin, e1, e2)."""
    tri = mesh.vertices[mesh.faces]
    origin = tri[:, 0].copy()
    e1 = tri[:, 1] - tri[:, 0]
    e2 = tri[:, 2] - tri[:, 0]
    metric = np.empty((len(mesh.faces), 2, 2))
    metric[:, 0, 0] = np.einsum("ij,ij->i", e1, e1)
    metric[:, 0, 1] = np.einsum("ij,ij->i", e1, e2)
    metric[:, 1, 0] = metric[:, 0, 1]
    metric[:, 1, 1] = np.einsum("ij,ij->i", e2, e2)
    inv = np.linalg.inv(metric)
    return origin, e1, e2, inv


def barycentrics(mesh, origin, e1, e2, inv, face_id, point):
    """Barycentric coords (l0, l1, l2) of point inside face face_id."""
    rel = point - origin[face_id]
    rhs = np.array([rel @ e1[face_id], rel @ e2[face_id]])
    l1, l2 = inv[face_id] @ rhs
    l0 = 1.0 - l1 - l2
    return np.array([l0, l1, l2])


def evaluate_direction(mesh, field_directions, face_id, bary,
                       current=None):
    """Barycentrically interpolated tangent direction inside a face.

    Vertex directions are sign-aligned to ``current`` (when given) before
    interpolation, keeping the line field continuous along a streamline.
    """
    tri = mesh.faces[face_id]
    vecs = field_directions[tri].copy()
    if current is not None:
        signs = np.sign(vecs @ current)
        signs[signs == 0.0] = 1.0
        vecs *= signs[:, None]
    vec = bary @ vecs
    normal = mesh.face_normals[face_id]
    vec = vec - normal * (vec @ normal)
    norm = np.linalg.norm(vec)
    if norm < 1e-12:
        return None
    return vec / norm
