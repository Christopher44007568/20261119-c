"""Mesh verification: face orientation and boundary-loop topology.

Every directed edge ``(a, b)`` of a consistently oriented manifold has
exactly one reverse counterpart.  Edges without a reverse form boundary
loops; edges with more than one reverse are non-manifold.  Orientation is
confirmed two ways: edge pairing and a positive signed volume (outward
normals) for watertight meshes.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from .mesh import Mesh, outward_normal
from .vector import Vec, dot, sub


Edge = tuple[int, int]


@dataclass
class ValidationReport:
    vertex_count: int
    face_count: int
    boundary_loops: list[list[Edge]] = field(default_factory=list)
    boundary_edge_count: int = 0
    non_manifold_edges: list[Edge] = field(default_factory=list)
    inconsistent_edges: list[Edge] = field(default_factory=list)
    signed_volume: float = 0.0
    outward_oriented: bool = False
    watertight: bool = False
    radial_outward_faces: int = 0
    radial_total_faces: int = 0
    radial_all_outward: bool = False

    @property
    def boundary_loop_count(self) -> int:
        return len(self.boundary_loops)

    def summary(self) -> str:
        status = "PASS" if self.passed else "FAIL"
        lines = [
            f"[{status}] vertices={self.vertex_count} faces={self.face_count}",
            f"  boundary loops      : {self.boundary_loop_count}"
            f" ({self.boundary_edge_count} boundary edges)",
            f"  non-manifold edges  : {len(self.non_manifold_edges)}",
            f"  orientation conflicts: {len(self.inconsistent_edges)}",
            f"  watertight          : {self.watertight}",
            f"  outward orientation : {self.outward_oriented}"
            f" (signed volume={self.signed_volume:.6g}; supplementary radial "
            f"check {self.radial_outward_faces}/{self.radial_total_faces})",
        ]
        return "\n".join(lines)

    @property
    def passed(self) -> bool:
        return (
            not self.non_manifold_edges
            and not self.inconsistent_edges
            and self.outward_oriented
        )


def _edge_counts(mesh: Mesh):
    forward: dict[Edge, int] = defaultdict(int)
    reverse: dict[Edge, int] = defaultdict(int)
    for face in mesh.faces:
        for i in range(len(face)):
            a, b = face[i], face[(i + 1) % len(face)]
            forward[(a, b)] += 1
            reverse[(b, a)] += 1
    return forward, reverse


def _trace_loops(edges: set[Edge]) -> list[list[Edge]]:
    remaining = set(edges)
    loops: list[list[Edge]] = []
    while remaining:
        first = next(iter(remaining))
        loop = [first]
        remaining.remove(first)
        current = first
        while True:
            candidates = [e for e in remaining if e[0] == current[1]]
            if not candidates:
                break
            edge = candidates[0]
            loop.append(edge)
            remaining.remove(edge)
            current = edge
            if current[1] == first[0]:
                break
        loops.append(loop)
    return loops


def signed_volume(mesh: Mesh) -> float:
    """Signed volume via tetrahedron fan; positive = outward orientation."""
    total = 0.0
    for face in mesh.faces:
        base = mesh.vertices[face[0]]
        normal_acc = [0.0, 0.0, 0.0]
        for i in range(1, len(face) - 1):
            a = sub(mesh.vertices[face[i]], base)
            b = sub(mesh.vertices[face[i + 1]], base)
            cross_ab = (
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
            )
            total += dot(base, cross_ab) / 6.0
            normal_acc[0] += cross_ab[0]
    return total


def validate_mesh(mesh: Mesh) -> ValidationReport:
    forward, reverse = _edge_counts(mesh)
    all_edges = set(forward) | set(reverse)
    boundary: set[Edge] = set()
    non_manifold: list[Edge] = []
    inconsistent: list[Edge] = []

    for edge in all_edges:
        fwd = forward.get(edge, 0)
        rev = reverse.get(edge, 0)
        if fwd > 1 or rev > 1:
            non_manifold.append(edge)
        if fwd == 1 and rev == 0:
            boundary.add(edge)
        if fwd >= 1 and rev >= 1 and fwd != rev:
            inconsistent.append(edge)

    loops = _trace_loops(boundary)
    volume = signed_volume(mesh)
    watertight = not boundary and not non_manifold
    if watertight:
        outward = volume > 0.0
    else:
        # Open meshes cannot use signed volume.  Consistent pairing means
        # every interior edge has one face on each side with opposite winding,
        # which is exactly the definition of coherent face orientation.
        def _coherent(edge: Edge) -> bool:
            f, r = forward.get(edge, 0), reverse.get(edge, 0)
            return f == r or (f == 1 and r == 0) or (f == 0 and r == 1)

        outward = not inconsistent and all(_coherent(e) for e in all_edges)

    return ValidationReport(
        vertex_count=len(mesh.vertices),
        face_count=len(mesh.faces),
        boundary_loops=loops,
        boundary_edge_count=len(boundary),
        non_manifold_edges=non_manifold,
        inconsistent_edges=inconsistent,
        signed_volume=volume,
        outward_oriented=outward,
        watertight=watertight,
    )


def normal_spot_check(mesh: Mesh, samples: int = 8) -> list[tuple[int, bool]]:
    """Check selected face normals point away from the mesh centroid."""
    if not mesh.faces:
        return []
    cx = sum(v[0] for v in mesh.vertices) / len(mesh.vertices)
    cy = sum(v[1] for v in mesh.vertices) / len(mesh.vertices)
    cz = sum(v[2] for v in mesh.vertices) / len(mesh.vertices)
    centroid = (cx, cy, cz)
    step = max(1, len(mesh.faces) // samples)
    checks = []
    for idx in range(0, len(mesh.faces), step)[:samples]:
        face = mesh.faces[idx]
        fc = (
            sum(mesh.vertices[i][0] for i in face) / len(face),
            sum(mesh.vertices[i][1] for i in face) / len(face),
            sum(mesh.vertices[i][2] for i in face) / len(face),
        )
        normal = outward_normal(face, mesh.vertices)
        outward = dot(normal, sub(fc, centroid)) >= 0.0
        checks.append((idx, outward))
    return checks


def radial_orientation_check(
    mesh: Mesh, frames, ring_size: int, closed: bool
) -> tuple[bool, int, int]:
    """Verify body face normals point away from the section plane.

    Each body face spans one section edge; the outward direction combines
    that edge's 2D direction expressed in the frame normal/binormal basis.
    This works for open tubes and for planar closed paths where the ring
    center itself lies on the inside of the loop.
    """
    span = len(frames) if closed else len(frames) - 1
    body_face_count = span * ring_size
    outward_hits = 0
    for face_index in range(min(body_face_count, len(mesh.faces))):
        face = mesh.faces[face_index]
        ring = face_index // ring_size
        frame = frames[ring]
        # Recover the 2D section coordinates of the edge vertices from the
        # ring-major vertex layout, then point toward the edge midpoint in
        # the normal/binormal plane (works for any section shape).
        edge = face_index % ring_size
        base = ring * ring_size
        # Average the outward radial vectors of the two section vertices.
        # Radial vectors are well defined even where an edge faces the
        # interior of a closed centerline loop.
        radial_acc = [0.0, 0.0, 0.0]
        for vertex_index in (base + edge, base + (edge + 1) % ring_size):
            delta = sub(mesh.vertices[vertex_index], frame.position)
            for k in range(3):
                radial_acc[k] += delta[k]
        outward_dir: Vec = (radial_acc[0], radial_acc[1], radial_acc[2])
        normal = outward_normal(face, mesh.vertices)
        if dot(normal, outward_dir) > 0.0:
            outward_hits += 1
    return outward_hits == body_face_count, outward_hits, body_face_count
