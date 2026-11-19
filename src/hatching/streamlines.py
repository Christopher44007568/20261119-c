"""Object-space streamline tracing directly on the triangulated surface.

Each streamline is integrated with a midpoint (RK2) rule inside triangle
faces.  When an integration step leaves its face the exact edge-crossing is
computed, the integrator continues in the neighbouring face, and every
point is re-clamped onto the analytic surface.  Consequently the polyline is
genuinely attached to the mesh in object space and survives arbitrary camera
rotation without sliding; no screen-space texture is involved.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .field import barycentrics, evaluate_direction


@dataclass
class Streamline:
    line_id: int
    layer: int
    points: np.ndarray            # (K, 3) object-space surface points
    faces: np.ndarray             # (K,) face containing each point
    arc_length: float
    breaks: list = field(default_factory=list)  # list of BreakRecord dicts


def _bary_at(mesh, origin, e1, e2, inv, face_id, point):
    return barycentrics(mesh, origin, e1, e2, inv, face_id, point)


def _edge_crossing(mesh, face_id, p_inside, p_outside, bary_out):
    """Exact intersection of the segment p_inside -> p_outside with a face edge.

    Returns (point, crossed_edge_local, neighbour_face).
    """
    bary = bary_out
    # negative barycentric coordinate corresponds to the crossed edge; the
    # edge opposite local vertex k is between the other two vertices.
    k = int(np.argmin(bary))
    t = -bary[k]  # at the crossing the k-th bary coord is 0
    point = p_inside + t * (p_outside - p_inside)
    neighbour = int(mesh.face_adj[face_id, k])
    return point, k, neighbour


def _move_one_step(mesh, geom, field_directions, face_id, point, direction,
                   step):
    """Advance one RK2 step, walking across triangle edges as needed.

    Returns (new_point, new_face, new_direction, crossed_boundary).
    """
    origin, e1, e2, inv = geom
    remaining = step
    guard = 0
    while remaining > 0.0 and guard < 16:
        guard += 1
        mid = point + direction * (0.5 * remaining)
        bary_mid = _bary_at(mesh, origin, e1, e2, inv, face_id, mid)
        if (bary_mid >= -1e-9).all():
            d_mid = evaluate_direction(mesh, field_directions, face_id,
                                       np.clip(bary_mid, 0, 1), direction)
            if d_mid is None:
                return point, face_id, direction, False
            if d_mid @ direction < 0.0:
                d_mid = -d_mid
            nxt = point + d_mid * remaining
            bary_nxt = _bary_at(mesh, origin, e1, e2, inv, face_id, nxt)
            if (bary_nxt >= -1e-9).all():
                return nxt, face_id, d_mid, False
            cross_point, edge_k, neighbour = _edge_crossing(
                mesh, face_id, point, nxt, bary_nxt)
            travelled = np.linalg.norm(cross_point - point)
            remaining = max(remaining - travelled, 0.0)
            if neighbour < 0:
                return cross_point, face_id, direction, True
            face_id = neighbour
            point = cross_point
            direction = d_mid
        else:
            # midpoint already outside: clip straight to the edge
            cross_point, edge_k, neighbour = _edge_crossing(
                mesh, face_id, point, mid, bary_mid)
            travelled = np.linalg.norm(cross_point - point)
            remaining = max(remaining - travelled, 0.0)
            if neighbour < 0:
                return cross_point, face_id, direction, True
            face_id = neighbour
            point = cross_point
    return point, face_id, direction, False


def _confident_fraction(mesh, curv, face_id, bary):
    return float(bary @ curv.confident[mesh.faces[face_id]].astype(float))


def _face_characteristic_length(mesh, face_id):
    tri = mesh.vertices[mesh.faces[face_id]]
    edges = np.linalg.norm(np.vstack([
        tri[1] - tri[0], tri[2] - tri[1], tri[0] - tri[2]]), axis=1)
    return float(edges.mean())


def _trace_half(mesh, geom, curv, field_directions, face_id, point,
                direction, step, max_steps, fallback):
    """Integrate in one direction until a stop condition.

    Stop reasons:
      boundary : stepped off a mesh boundary edge;
      umbilic  : entered a non-confident (flat/near-umbilic) region, or a
                 fallback dash reached its prescribed short length;
      length   : hard safety cap on arc length.
    """
    pts = [point.copy()]
    fids = [face_id]
    length = 0.0
    reason = "length"
    dash_budget = (1.0 * _face_characteristic_length(mesh, face_id)
                   if fallback else np.inf)
    for _ in range(max_steps):
        new_point, new_face, new_dir, hit_boundary = _move_one_step(
            mesh, geom, field_directions, face_id, point, direction, step)
        ds = np.linalg.norm(new_point - point)
        length += ds
        point, face_id, direction = new_point, new_face, new_dir
        point = mesh.project(point[None, :])[0]
        pts.append(point.copy())
        fids.append(face_id)
        if hit_boundary:
            reason = "boundary"
            break
        if not fallback:
            bary = _bary_at(mesh, *geom, face_id, point)
            if _confident_fraction(mesh, curv, face_id,
                                   np.clip(bary, 0, 1)) < 0.5:
                reason = "umbilic"
                break
        else:
            # Coherent fallback field collapses to near-zero at transport
            # singularities; terminate there instead of drawing spirals.
            bary = _bary_at(mesh, *geom, face_id, point)
            tri = mesh.faces[face_id]
            raw = np.clip(bary, 0, 1) @ field_directions[tri]
            if np.linalg.norm(raw) < 0.5:
                reason = "umbilic"
                break
        if length >= dash_budget:
            reason = "umbilic"
            break
    return np.asarray(pts), np.asarray(fids), length, reason


def trace_streamlines(mesh, curv, field_directions, seeds, seed_faces,
                      seed_bary, layer_index, spacing):
    """Trace one bidirectional streamline per accepted seed point."""
    geom = (None, None, None, None)
    from .field import face_vertex_coordinates
    geom = face_vertex_coordinates(mesh)
    step = 0.4 * mesh.mean_edge
    max_steps = int(40.0 * np.linalg.norm(
        mesh.vertices.max(axis=0) - mesh.vertices.min(axis=0)) / step)
    lines = []
    # Voxel-grid distance dedup: two seeds closer than the layer spacing in
    # object space never both spawn lines, giving isotropic line density
    # even when many streamlines run nearly parallel (as on the saddle).
    low = mesh.vertices.min(axis=0)
    extent = np.maximum(mesh.vertices.max(axis=0) - low, 1e-9)
    grid_shape = np.maximum(np.ceil(extent / spacing).astype(int), 1)
    occupied_cells: set[tuple[int, int, int]] = set()

    def cell_of(point):
        idx = np.floor((point - low) / spacing).astype(int)
        idx = np.clip(idx, 0, grid_shape - 1)
        return tuple(int(v) for v in idx)

    def neighbourhood_free(point):
        cx, cy, cz = cell_of(point)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    if (cx + dx, cy + dy, cz + dz) in occupied_cells:
                        return False
        return True

    for line_id, (seed, face_id, bary) in enumerate(
            zip(seeds, seed_faces, seed_bary)):
        if not neighbourhood_free(seed):
            continue
        fallback = _confident_fraction(mesh, curv, face_id, bary) <= 0.5
        d0 = evaluate_direction(mesh, field_directions, face_id,
                                np.clip(bary, 0, 1))
        if d0 is None:
            continue
        occupied_cells.add(cell_of(seed))
        fwd_p, fwd_f, fwd_len, fwd_reason = _trace_half(
            mesh, geom, curv, field_directions, face_id, seed.copy(),
            d0.copy(), step, max_steps, fallback)
        bwd_p, bwd_f, bwd_len, bwd_reason = _trace_half(
            mesh, geom, curv, field_directions, face_id, seed.copy(),
            -d0.copy(), step, max_steps, fallback)
        points = np.vstack([bwd_p[::-1], fwd_p[1:]])
        faces = np.concatenate([bwd_f[::-1], fwd_f[1:]])
        arc = float(np.sum(np.linalg.norm(np.diff(points, axis=0), axis=1)))
        breaks = [
            dict(line_id=line_id, layer=layer_index, reason=bwd_reason,
                 face=int(faces[0]), xyz=points[0]),
            dict(line_id=line_id, layer=layer_index, reason=fwd_reason,
                 face=int(faces[-1]), xyz=points[-1]),
        ]
        lines.append(Streamline(line_id=line_id, layer=layer_index,
                                points=points, faces=faces,
                                arc_length=arc, breaks=breaks))
    return lines
