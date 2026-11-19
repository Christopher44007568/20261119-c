"""Topological and geometric consistency checks for a half-edge mesh."""

from __future__ import annotations

from .geometry import EPS
from .mesh import HalfEdgeMesh


def _edge_connected_components(mesh: HalfEdgeMesh) -> int:
    parent = list(range(len(mesh.vertices)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    used = [False] * len(mesh.vertices)
    for edge in mesh.edges:
        u = mesh.halfedges[edge.he_forward].origin
        v = mesh.halfedges[edge.he_backward].origin
        used[u] = used[v] = True
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
    roots = {find(v) for v, active in enumerate(used) if active}
    return len(roots)


def validate(mesh: HalfEdgeMesh) -> dict:
    problems: list[str] = []

    # 1. Every half-edge is used by exactly one face and next/twin are sound.
    seen = [0] * len(mesh.halfedges)
    for face in mesh.faces:
        for loop in face.loops:
            for hid in loop:
                seen[hid] += 1
    if any(count != 1 for count in seen):
        problems.append("some half-edge is skipped or traversed more than once")

    # Bridges (dangling edges) have both half-edges assigned to one face.
    bridge_edges: list[int] = []
    for edge in mesh.edges:
        f_forward = mesh.halfedges[edge.he_forward].face
        f_backward = mesh.halfedges[edge.he_backward].face
        if f_forward == f_backward:
            bridge_edges.append(edge.eid)

    # 2. next pointers form closed rings. A half-edge may appear at most once.
    #    A bridge (dangling edge) is walked in both directions inside one
    #    spur loop, so the same edge id may repeat - but never the same he.
    for face in mesh.faces:
        for loop in face.loops:
            if len(loop) != len(set(loop)):
                problems.append(f"face {face.fid} repeats a half-edge")
            edge_ids = [mesh.halfedges[h].edge for h in loop]
            repeated = {e for e in edge_ids if edge_ids.count(e) > 1}
            non_bridge = repeated - set(bridge_edges)
            if non_bridge:
                problems.append(
                    f"face {face.fid} repeats non-bridge edges {sorted(non_bridge)}")
            first = loop[0]
            walker = first
            for _ in loop:
                walker = mesh.halfedges[walker].next
            if walker != first:
                problems.append(f"face {face.fid} loop is not closed via next")

    # 3. Twin symmetry and destination continuity.
    for he in mesh.halfedges:
        twin = mesh.halfedges[he.twin]
        if twin.twin != he.hid or twin.origin != mesh.destination(he.hid):
            problems.append(f"half-edge {he.hid} has an inconsistent twin")

    # 4. Euler characteristic V - E + F = 1 + C for planar subdivisions.
    v_count = len(mesh.vertices)
    e_count = len(mesh.edges)
    f_count = len(mesh.faces)
    components = _edge_connected_components(mesh)
    euler = v_count - e_count + f_count
    euler_ok = euler == 1 + components
    if not euler_ok:
        problems.append(
            f"Euler characteristic {euler} != 1 + C ({1 + components})")

    bounded = [f for f in mesh.faces if f.bounded]
    total_area = sum(f.area for f in bounded)

    # 5. Algebraic area of all oriented loops must cancel out.
    from .faces import _loop_vertices, signed_area
    algebraic_sum = 0.0
    for face in mesh.faces:
        for loop in face.loops:
            algebraic_sum += signed_area(_loop_vertices(mesh, loop))
    if abs(algebraic_sum) > 1e-7:
        problems.append("signed loop areas do not sum to zero")

    return {
        "ok": not problems,
        "problems": problems,
        "vertices": v_count,
        "edges": e_count,
        "faces": f_count,
        "halfedges": len(mesh.halfedges),
        "components": components,
        "euler_characteristic": euler,
        "euler_expected": 1 + components,
        "total_bounded_area": total_area,
        "bridge_edges": bridge_edges,
        "algebraic_area_sum": algebraic_sum,
        "area_tolerance": EPS,
    }
