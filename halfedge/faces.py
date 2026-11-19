"""Extract faces from next-linked half-edge loops."""

from __future__ import annotations

from .geometry import EPS
from .mesh import Face, HalfEdgeMesh


def _loop_vertices(mesh: HalfEdgeMesh, loop: list[int]) -> list[tuple[float, float]]:
    points = []
    for hid in loop:
        v = mesh.vertices[mesh.halfedges[hid].origin]
        points.append((v.x, v.y))
    return points


def signed_area(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
        total += x1 * y2 - x2 * y1
    return 0.5 * total


def point_in_polygon(px: float, py: float, points: list[tuple[float, float]]) -> bool:
    """Strict interior test; boundary points return False."""
    inside = False
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
        if abs(cross) <= EPS and min(x1, x2) - EPS <= px <= max(x1, x2) + EPS \
                and min(y1, y2) - EPS <= py <= max(y1, y2) + EPS:
            return False
        if (y1 > py) != (y2 > py):
            hit = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
            if hit > px:
                inside = not inside
    return inside


def collect_loops(mesh: HalfEdgeMesh) -> list[list[int]]:
    visited = [False] * len(mesh.halfedges)
    loops: list[list[int]] = []
    for start in range(len(mesh.halfedges)):
        if visited[start]:
            continue
        loop: list[int] = []
        hid = start
        while not visited[hid]:
            visited[hid] = True
            loop.append(hid)
            hid = mesh.halfedges[hid].next
        if hid != start:
            raise RuntimeError("half-edge next walk did not return to its start")
        loops.append(loop)
    return loops


def _representative(mesh: HalfEdgeMesh, loop: list[int]) -> tuple[float, float]:
    v = mesh.vertices[mesh.halfedges[loop[0]].origin]
    return v.x, v.y


def extract_faces(mesh: HalfEdgeMesh) -> None:
    """Group half-edge loops into bounded faces plus one outer face."""
    loops = collect_loops(mesh)
    records = []
    for loop in loops:
        points = _loop_vertices(mesh, loop)
        area = signed_area(points)
        records.append({
            "loop": loop,
            "points": points,
            "area": area,
            "rep": _representative(mesh, loop),
            "zero": abs(area) <= EPS,
        })

    area_loops = [r for r in records if not r["zero"]]
    zero_loops = [r for r in records if r["zero"]]

    def innermost_container(rec: dict) -> dict | None:
        """Smallest area loop strictly containing rec's representative point."""
        best: dict | None = None
        for candidate in area_loops:
            if candidate is rec:
                continue
            if point_in_polygon(*rec["rep"], candidate["points"]):
                if best is None or abs(candidate["area"]) < abs(best["area"]):
                    best = candidate
        return best

    parent: dict[int, dict | None] = {
        id(r): innermost_container(r) for r in area_loops
    }

    # A CCW loop is a bounded outer boundary. Its direct CW children are its
    # hole boundaries; an island CCW loop inside such a CW loop belongs to a
    # separate bounded face, and its surrounding region stays with the face
    # that owns the CW loop (outer face when nesting depth reaches it).
    faces: list[Face] = []
    ccw_records = [r for r in area_loops if r["area"] > 0]
    for rec in ccw_records:
        holes = [
            r for r in area_loops
            if r["area"] < 0 and parent[id(r)] is rec
        ]
        area = rec["area"] + sum(r["area"] for r in holes)
        faces.append(Face(
            fid=-1,
            loops=[rec["loop"]] + [r["loop"] for r in holes],
            bounded=True,
            area=area,
        ))

    def owns_region(rec: dict) -> Face | None:
        """Face governing the region immediately inside a given loop."""
        node = rec
        while node is not None:
            if node["area"] > 0:
                return next(f for f in faces if f.loops[0] is node["loop"])
            node = parent[id(node)]
        return None

    outer_loops = [
        r["loop"] for r in area_loops
        if r["area"] < 0 and parent[id(r)] is None
    ]
    outer_face = Face(fid=-1, loops=outer_loops, bounded=False, area=0.0)
    faces.append(outer_face)

    for rec in zero_loops:
        host = innermost_container(rec)
        target = owns_region(host) if host is not None else None
        if target is None:
            target = outer_face
        target.loops.append(rec["loop"])

    bounded = sorted((f for f in faces if f.bounded),
                     key=lambda f: (-f.area, _face_sort_key(mesh, f)))
    outer = next(f for f in faces if not f.bounded)
    ordered = bounded + [outer]
    for fid, face in enumerate(ordered):
        face.fid = fid
        for loop in face.loops:
            for hid in loop:
                mesh.halfedges[hid].face = fid
    mesh.faces = ordered


def _face_sort_key(mesh: HalfEdgeMesh, face: Face) -> tuple[float, float]:
    v = mesh.vertices[mesh.halfedges[face.loops[0][0]].origin]
    return round(v.x, 6), round(v.y, 6)
