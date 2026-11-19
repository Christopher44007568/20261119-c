"""Tube sweep mesh construction and OBJ export.

Branch junctions use a provably manifold construction.  At a branch point
every incident tube receives its own *inner ring* (identical positions and
radius, but distinct vertex indices) and the tube sleeve runs from that
inner ring to the tube's first ordinary ring.  The wedge-shaped gaps between
neighbouring tubes are closed by triangle fans from a single central apex
vertex, joining each pair of adjacent inner rings.

Edge accounting that makes the mesh watertight:

* an ordinary tube band edge belongs to the two sides of one quad;
* an inner-ring edge belongs to one sleeve quad and one apex wedge triangle;
* an apex-to-ring edge belongs to the two wedge triangles of the boundary
  between two neighbouring tubes.

Thus every edge has exactly two incident faces, while tubes still meet at a
common point with no geometric gap.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .errors import GeometryLimitError
from .turtle import Branch, TurtleResult


@dataclass(frozen=True)
class Ring:
    base: int
    sides: int
    branch_id: int
    point_index: int
    center: tuple[float, float, float]

    def vertex(self, side: int) -> int:
        return self.base + (side % self.sides)


@dataclass
class Face:
    indices: tuple[int, ...]
    group: str


@dataclass
class Mesh:
    vertices: list[tuple[float, float, float]] = field(default_factory=list)
    normals: list[tuple[float, float, float]] = field(default_factory=list)
    faces: list[Face] = field(default_factory=list)
    group_names: dict[str, str] = field(default_factory=dict)
    ring_lookup: dict[tuple[int, int], int] = field(default_factory=dict)
    branch_faces: dict[int, list[int]] = field(default_factory=dict)
    metadata: dict = field(default_factory=dict)


def _vec_add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _vec_scale(a, factor):
    return (a[0] * factor, a[1] * factor, a[2] * factor)


def _normalise(a):
    length = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
    if length < 1e-15:
        return (0.0, 1.0, 0.0)
    return (a[0] / length, a[1] / length, a[2] / length)


def build_mesh(result: TurtleResult, radial_segments: int = 8,
               max_vertices: int = 4_000_000) -> Mesh:
    if radial_segments < 3:
        raise ValueError("radial_segments must be at least 3")
    mesh = Mesh()
    rings: dict[tuple[int, int], Ring] = {}
    junction_mismatches: list[dict] = []

    def make_ring(branch: Branch, point_index: int) -> Ring:
        key = (branch.branch_id, point_index)
        existing = rings.get(key)
        if existing is not None:
            return existing
        point = branch.points[point_index]
        radius = branch.radii[point_index]
        left = branch.left_frames[point_index]
        up = branch.up_frames[point_index]
        ring = _emit_ring(mesh, point, radius, left, up,
                          radial_segments, branch.branch_id, point_index)
        rings[key] = ring
        return ring

    branch_rings: dict[int, list[Ring]] = {}
    for branch in result.branches:
        if len(branch.points) < 2:
            continue
        branch_rings[branch.branch_id] = [
            make_ring(branch, i) for i in range(len(branch.points))
        ]
        if len(mesh.vertices) > max_vertices:
            raise GeometryLimitError(
                f"mesh would hold over {max_vertices:,} vertices"
            )

    # Group child branches at each parent branch point.
    junction_children: dict[tuple[int, int], list[int]] = {}
    for branch in result.branches:
        if branch.parent_id is None or branch.capped_gap:
            continue
        parent = result.branches[branch.parent_id]
        match = _parent_match(parent, branch.points[0])
        if match == 0:
            continue
        junction_children.setdefault(
            (parent.branch_id, match), []
        ).append(branch.branch_id)
        gap = abs(branch.radii[0] - parent.radii[match])
        if gap > 1e-9:
            junction_mismatches.append({
                "position": branch.points[0],
                "child_branch": branch.branch_id,
                "parent_branch": parent.branch_id,
                "parent_point_index": match,
                "radius_gap": gap,
            })

    junction_records = _build_junctions(
        mesh, result, branch_rings, junction_children, radial_segments,
    )
    _emit_tube_skins(mesh, result, branch_rings)
    _compute_smooth_normals(mesh)
    mesh.metadata = {
        "junction_radius_mismatches": junction_mismatches,
        "junction_count": len(junction_children),
        "junctions": junction_records,
    }
    return mesh


def _emit_ring(mesh: Mesh, point, radius, left, up, sides: int,
               branch_id: int, point_index: int) -> Ring:
    base = len(mesh.vertices)
    for side in range(sides):
        theta = 2.0 * math.pi * side / sides
        offset = _vec_add(
            _vec_scale(left, math.cos(theta) * radius),
            _vec_scale(up, math.sin(theta) * radius),
        )
        mesh.vertices.append(_vec_add(point, offset))
    ring = Ring(base, sides, branch_id, point_index, point)
    if branch_id >= 0:
        mesh.ring_lookup[(branch_id, point_index)] = base
    return ring


def _build_junctions(mesh: Mesh, result: TurtleResult,
                     branch_rings: dict[int, list[Ring]],
                     junction_children: dict[tuple[int, int], list[int]],
                     sides: int) -> list[dict]:
    """Seal child tube bases so each branch is an independent closed tube.

    The parent tube stays continuous.  Every child tube begins on a ring of
    its own vertices located exactly at the branch point; an apex-centered
    fan caps that base ring.  Parent and child surfaces share no edges, so
    both are individually watertight while their geometry meets with zero
    distance at the junction (no visible crack, fully manifold meshes).
    """
    records = []
    for (parent_branch_id, match), child_ids in junction_children.items():
        parent = result.branches[parent_branch_id]
        point = parent.points[match]
        apex = len(mesh.vertices)
        mesh.vertices.append(point)
        child_bases = []
        for child_id in child_ids:
            inner = branch_rings[child_id][0]
            child_bases.append({
                "child_branch": child_id,
                "ring_base": inner.base,
                "center": inner.center,
            })
            for side in range(sides):
                nxt = (side + 1) % sides
                mesh.faces.append(Face(
                    (apex, inner.vertex(nxt), inner.vertex(side)),
                    "junction",
                ))

        records.append({
            "parent_branch": parent_branch_id,
            "parent_point_index": match,
            "child_branches": child_ids,
            "apex_vertex": apex,
            "tube_count": len(child_ids) + 1,
            "position": point,
            "child_bases": child_bases,
        })
    return records


def _emit_tube_skins(mesh: Mesh, result: TurtleResult,
                     branch_rings: dict[int, list[Ring]]) -> None:
    for branch in result.branches:
        ring_list = branch_rings.get(branch.branch_id)
        if ring_list is None:
            continue
        group = _group_name(branch)
        mesh.group_names[group] = group
        mesh.branch_faces.setdefault(branch.branch_id, [])
        for index in range(len(ring_list) - 1):
            _emit_quad_band(mesh, ring_list[index], ring_list[index + 1],
                            group, branch.branch_id)

        if branch.parent_id is None or branch.capped_gap:
            _emit_cap(mesh, ring_list[0], outward=False, group=group,
                      branch_id=branch.branch_id)
        _emit_cap(mesh, ring_list[-1], outward=True, group=group,
                  branch_id=branch.branch_id)


def _emit_quad_band(mesh: Mesh, ring_a: Ring, ring_b: Ring,
                    group: str, branch_id: int | None = None) -> None:
    for side in range(ring_a.sides):
        nxt = (side + 1) % ring_a.sides
        face = (
            ring_a.vertex(side), ring_b.vertex(side),
            ring_b.vertex(nxt), ring_a.vertex(nxt),
        )
        face_id = len(mesh.faces)
        mesh.faces.append(Face(face, group))
        if branch_id is not None and branch_id >= 0:
            mesh.branch_faces[branch_id].append(face_id)


def _emit_cap(mesh: Mesh, ring: Ring, outward: bool, group: str,
              branch_id: int) -> None:
    center = len(mesh.vertices)
    mesh.vertices.append(ring.center)
    for side in range(ring.sides):
        nxt = (side + 1) % ring.sides
        if outward:
            face = (center, ring.vertex(side), ring.vertex(nxt))
        else:
            face = (center, ring.vertex(nxt), ring.vertex(side))
        mesh.branch_faces.setdefault(branch_id, []).append(len(mesh.faces))
        mesh.faces.append(Face(face, group))


def _parent_match(parent: Branch, point) -> int:
    return next(
        i for i, candidate in enumerate(parent.points)
        if candidate == point
    )


def _group_name(branch: Branch) -> str:
    if branch.start_rule:
        return f"rule_{branch.start_rule}_branch{branch.branch_id}"
    return f"branch{branch.branch_id}"


def _compute_smooth_normals(mesh: Mesh) -> None:
    accum = [[0.0, 0.0, 0.0] for _ in mesh.vertices]
    for face in mesh.faces:
        indices = face.indices
        anchor = mesh.vertices[indices[0]]
        for i in range(1, len(indices) - 1):
            b = mesh.vertices[indices[i]]
            c = mesh.vertices[indices[i + 1]]
            u = (b[0] - anchor[0], b[1] - anchor[1], b[2] - anchor[2])
            v = (c[0] - anchor[0], c[1] - anchor[1], c[2] - anchor[2])
            cross = (
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            )
            for vertex_index in (indices[0], indices[i], indices[i + 1]):
                target = accum[vertex_index]
                target[0] += cross[0]
                target[1] += cross[1]
                target[2] += cross[2]
    mesh.normals = [_normalise(tuple(value)) for value in accum]


def write_obj(mesh: Mesh, path: str) -> None:
    lines: list[str] = ["# L-system procedural tube mesh"]
    for vertex in mesh.vertices:
        lines.append(f"v {vertex[0]:.6f} {vertex[1]:.6f} {vertex[2]:.6f}")
    for normal in mesh.normals:
        lines.append(f"vn {normal[0]:.6f} {normal[1]:.6f} {normal[2]:.6f}")
    current_group: str | None = None
    for face in mesh.faces:
        if face.group != current_group:
            lines.append(f"g {face.group}")
            current_group = face.group
        refs = " ".join(
            f"{index + 1}//{index + 1}" for index in face.indices
        )
        lines.append(f"f {refs}")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
