"""Topology JSON export."""

from __future__ import annotations

import json

from .check import validate
from .faces import _loop_vertices, signed_area
from .mesh import HalfEdgeMesh


def mesh_to_dict(mesh: HalfEdgeMesh) -> dict:
    return {
        "vertices": [
            {"id": v.vid, "x": round(v.x, 9), "y": round(v.y, 9)}
            for v in mesh.vertices
        ],
        "edges": [
            {
                "id": e.eid,
                "halfedges": [e.he_forward, e.he_backward],
                "from": mesh.halfedges[e.he_forward].origin,
                "to": mesh.destination(e.he_forward),
                "sources": e.sources,
            }
            for e in mesh.edges
        ],
        "halfedges": [
            {
                "id": h.hid,
                "origin": h.origin,
                "destination": mesh.destination(h.hid),
                "twin": h.twin,
                "next": h.next,
                "face": h.face,
                "edge": h.edge,
            }
            for h in mesh.halfedges
        ],
        "faces": [
            {
                "id": f.fid,
                "bounded": f.bounded,
                "area": round(f.area, 9) if f.bounded else None,
                "loops": [
                    {
                        "halfedges": loop,
                        "vertex_path": [
                            mesh.halfedges[h].origin for h in loop
                        ],
                        "signed_area": round(
                            signed_area(_loop_vertices(mesh, loop)), 9),
                    }
                    for loop in f.loops
                ],
            }
            for f in mesh.faces
        ],
        "checks": validate(mesh),
    }


def write_topology_json(mesh: HalfEdgeMesh, path: str) -> dict:
    payload = mesh_to_dict(mesh)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    return payload
