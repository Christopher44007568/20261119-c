"""Match faces before and after an insertion by centroid containment."""

from __future__ import annotations

from .faces import point_in_polygon
from .mesh import Face, HalfEdgeMesh


def face_centroid(mesh: HalfEdgeMesh, face: Face) -> tuple[float, float]:
    loop = face.loops[0]
    xs = [mesh.vertices[mesh.halfedges[h].origin].x for h in loop]
    ys = [mesh.vertices[mesh.halfedges[h].origin].y for h in loop]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def match_faces(before: HalfEdgeMesh, after: HalfEdgeMesh) -> list[dict]:
    """Map each new bounded face to the old face containing its centroid."""
    before_faces = [f for f in before.faces if f.bounded]
    rows = []
    for new_face in (f for f in after.faces if f.bounded):
        cx, cy = face_centroid(after, new_face)
        old_id = None
        for old_face in before_faces:
            polygon = [
                (before.vertices[before.halfedges[h].origin].x,
                 before.vertices[before.halfedges[h].origin].y)
                for h in old_face.loops[0]
            ]
            if point_in_polygon(cx, cy, polygon):
                old_id = old_face.fid
                break
        rows.append({
            "old_face": old_id,
            "new_face": new_face.fid,
            "new_area": new_face.area,
        })
    return rows
