"""Sweep mesh construction.

For every path sample the 2D section is placed in the frame's normal/binormal
plane and optionally scaled.  Consecutive rings are stitched into outward
oriented quads; end caps are triangle fans.  The resulting polygon soup is
kept as an explicit, inspectable data structure rather than written to disk
immediately.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .frame import Frame
from .section import Section
from .vector import Vec, add, normalize, scale


@dataclass
class Mesh:
    vertices: list[Vec] = field(default_factory=list)
    faces: list[tuple[int, ...]] = field(default_factory=list)
    groups: list[tuple[str, int, int]] = field(default_factory=list)

    def add_vertex(self, point: Vec) -> int:
        self.vertices.append(point)
        return len(self.vertices) - 1


@dataclass
class SweepConfig:
    section: Section
    scales: list[float]
    cap_start: bool = True
    cap_end: bool = True
    closed: bool = False
    max_cross_section_dimension: float | None = None


def _ring_vertices(frame: Frame, section_points, mesh: Mesh) -> list[int]:
    indices = []
    for u, v in section_points:
        point = add(
            frame.position,
            add(scale(frame.normal, u), scale(frame.binormal, v)),
        )
        indices.append(mesh.add_vertex(point))
    return indices


def _centroid(ring: list[int], vertices: list[Vec]) -> Vec:
    x = sum(vertices[i][0] for i in ring) / len(ring)
    y = sum(vertices[i][1] for i in ring) / len(ring)
    z = sum(vertices[i][2] for i in ring) / len(ring)
    return (x, y, z)


def build_sweep(frames: list[Frame], config: SweepConfig) -> Mesh:
    if len(config.scales) != len(frames):
        raise ValueError("one scale factor per frame is required")
    mesh = Mesh()
    ring_size = len(config.section.points)
    rings: list[list[int]] = []

    for frame, factor in zip(frames, config.scales):
        section_points = config.section.scaled(
            factor, config.max_cross_section_dimension
        )
        rings.append(_ring_vertices(frame, section_points, mesh))

    body_start = len(mesh.faces)
    ring_count = len(rings)
    closed_sweep = config.closed
    span = ring_count if closed_sweep else ring_count - 1
    for r in range(span):
        ring_a = rings[r]
        ring_b = rings[(r + 1) % ring_count]
        for j in range(ring_size):
            jn = (j + 1) % ring_size
            # Winding chosen so the geometric normal points outward.
            mesh.faces.append((ring_a[j], ring_a[jn], ring_b[jn], ring_b[j]))
    mesh.groups.append(("tube_body", body_start, len(mesh.faces)))

    if not closed_sweep:
        if config.cap_start:
            start = len(mesh.faces)
            center = mesh.add_vertex(_centroid(rings[0], mesh.vertices))
            for j in range(ring_size):
                jn = (j + 1) % ring_size
                # Fan facing -tangent: reversed ring order.
                mesh.faces.append((center, rings[0][jn], rings[0][j]))
            mesh.groups.append(("cap_start", start, len(mesh.faces)))
        if config.cap_end:
            start = len(mesh.faces)
            center = mesh.add_vertex(_centroid(rings[-1], mesh.vertices))
            for j in range(ring_size):
                jn = (j + 1) % ring_size
                # Fan facing +tangent: ring order as stored.
                mesh.faces.append((center, rings[-1][j], rings[-1][jn]))
            mesh.groups.append(("cap_end", start, len(mesh.faces)))
    return mesh
def outward_normal(face: tuple[int, ...], vertices: list[Vec]) -> Vec:
    """Newell's method: robust normal for planar or near-planar polygons."""
    normal = [0.0, 0.0, 0.0]
    for i in range(len(face)):
        a = vertices[face[i]]
        b = vertices[face[(i + 1) % len(face)]]
        normal[0] += (a[1] - b[1]) * (a[2] + b[2])
        normal[1] += (a[2] - b[2]) * (a[0] + b[0])
        normal[2] += (a[0] - b[0]) * (a[1] + b[1])
    return normalize((normal[0], normal[1], normal[2]))


def mesh_bounds(mesh: Mesh) -> tuple[Vec, Vec]:
    mins = [min(v[k] for v in mesh.vertices) for k in range(3)]
    maxs = [max(v[k] for v in mesh.vertices) for k in range(3)]
    return (tuple(mins), tuple(maxs))  # type: ignore[return-value]
