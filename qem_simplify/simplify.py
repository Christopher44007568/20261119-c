from __future__ import annotations

import heapq
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Iterable

from .mesh import Face, ObjMesh, Vec3


def _sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _mul(a: Vec3, scale: float) -> Vec3:
    return (a[0] * scale, a[1] * scale, a[2] * scale)


def _dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _length(a: Vec3) -> float:
    return math.sqrt(_dot(a, a))


def _distance(a: Vec3, b: Vec3) -> float:
    return _length(_sub(a, b))


def _triangle_area_normal(a: Vec3, b: Vec3, c: Vec3) -> tuple[Vec3, float]:
    normal = _cross(_sub(b, a), _sub(c, a))
    twice_area = _length(normal)
    if twice_area <= 0.0:
        return (0.0, 0.0, 0.0), 0.0
    return normal, 0.5 * twice_area


@dataclass(frozen=True, slots=True)
class Quadric:
    """Symmetric 4x4 quadric stored as 10 independent coefficients."""

    a11: float = 0.0
    a12: float = 0.0
    a13: float = 0.0
    a22: float = 0.0
    a23: float = 0.0
    a33: float = 0.0
    b1: float = 0.0
    b2: float = 0.0
    b3: float = 0.0
    c: float = 0.0

    def __add__(self, other: Quadric) -> Quadric:
        return Quadric(
            self.a11 + other.a11,
            self.a12 + other.a12,
            self.a13 + other.a13,
            self.a22 + other.a22,
            self.a23 + other.a23,
            self.a33 + other.a33,
            self.b1 + other.b1,
            self.b2 + other.b2,
            self.b3 + other.b3,
            self.c + other.c,
        )

    @classmethod
    def from_plane(cls, normal: Vec3, offset: float, weight: float) -> Quadric:
        nx, ny, nz = normal
        return cls(
            weight * nx * nx,
            weight * nx * ny,
            weight * nx * nz,
            weight * ny * ny,
            weight * ny * nz,
            weight * nz * nz,
            weight * offset * nx,
            weight * offset * ny,
            weight * offset * nz,
            weight * offset * offset,
        )

    def error(self, point: Vec3) -> float:
        x, y, z = point
        value = (
            self.a11 * x * x
            + 2.0 * self.a12 * x * y
            + 2.0 * self.a13 * x * z
            + self.a22 * y * y
            + 2.0 * self.a23 * y * z
            + self.a33 * z * z
            + 2.0 * self.b1 * x
            + 2.0 * self.b2 * y
            + 2.0 * self.b3 * z
            + self.c
        )
        return max(0.0, value)


def _solve_quadric_minimum(q: Quadric) -> Vec3 | None:
    matrix = [
        [q.a11, q.a12, q.a13, -q.b1],
        [q.a12, q.a22, q.a23, -q.b2],
        [q.a13, q.a23, q.a33, -q.b3],
    ]
    scale = max(abs(value) for row in matrix for value in row)
    if scale <= 1e-20:
        return None
    threshold = 1e-12 * scale
    for column in range(3):
        pivot = max(range(column, 3), key=lambda row: abs(matrix[row][column]))
        if abs(matrix[pivot][column]) <= threshold:
            return None
        matrix[column], matrix[pivot] = matrix[pivot], matrix[column]
        pivot_value = matrix[column][column]
        for row in range(column + 1, 3):
            factor = matrix[row][column] / pivot_value
            if factor == 0.0:
                continue
            for item in range(column, 4):
                matrix[row][item] -= factor * matrix[column][item]

    solution = [0.0, 0.0, 0.0]
    for row in range(2, -1, -1):
        remainder = matrix[row][3]
        for column in range(row + 1, 3):
            remainder -= matrix[row][column] * solution[column]
        solution[row] = remainder / matrix[row][row]
    return (solution[0], solution[1], solution[2])


def _optimal_position(
    quadric: Quadric, first: Vec3, second: Vec3
) -> tuple[Vec3, float]:
    midpoint = _mul(_add(first, second), 0.5)
    candidates: list[Vec3] = [midpoint, first, second]
    solved = _solve_quadric_minimum(quadric)
    if solved is not None:
        edge_length = _distance(first, second)
        limit = max(1e-12, 4.0 * edge_length)
        if _distance(solved, midpoint) <= limit:
            candidates.insert(0, solved)

    best_point = midpoint
    best_error = math.inf
    best_distance = math.inf
    for point in candidates:
        error = quadric.error(point)
        distance = _distance(point, midpoint)
        if error < best_error - 1e-12 or (
            abs(error - best_error) <= 1e-12 and distance < best_distance
        ):
            best_point = point
            best_error = error
            best_distance = distance
    return best_point, best_error


@dataclass
class SimplifyOptions:
    target_faces: int
    protect_boundary: bool = True
    protect_material: bool = True
    protect_sharp: bool = True
    sharp_angle_degrees: float = 60.0
    min_normal_dot: float = 1e-8
    min_face_area: float = 1e-14
    max_error: float | None = None

    def __post_init__(self) -> None:
        if self.target_faces < 0:
            raise ValueError("target_faces must be non-negative")
        if not 0.0 < self.sharp_angle_degrees < 180.0:
            raise ValueError("sharp_angle_degrees must be between 0 and 180")


@dataclass
class SimplifyResult:
    vertices: list[Vec3]
    faces: list[Face]
    face_materials: list[str | None]
    initial_vertex_count: int
    initial_face_count: int
    final_vertex_count: int
    final_face_count: int
    stop_reason: str
    stop_detail: str
    rounds: list[dict] = field(default_factory=list)
    rejected: Counter = field(default_factory=Counter)
    feature_counts: dict[str, int] = field(default_factory=dict)
    validation: dict = field(default_factory=dict)

    @property
    def reached_target(self) -> bool:
        return self.final_face_count <= self.target_faces

    @property
    def target_faces(self) -> int:
        return self.validation["target_faces"]

    def report(self) -> dict:
        return {
            "target_faces": self.target_faces,
            "reached_target": self.reached_target,
            "stop_reason": self.stop_reason,
            "stop_detail": self.stop_detail,
            "initial": {
                "vertices": self.initial_vertex_count,
                "faces": self.initial_face_count,
            },
            "final": {
                "vertices": self.final_vertex_count,
                "faces": self.final_face_count,
            },
            "collapse_count": len(self.rounds),
            "round_errors": [
                {
                    "round": item["round"],
                    "edge": item["edge"],
                    "quadric_error": item["quadric_error"],
                    "cumulative_error": item["cumulative_error"],
                    "faces_after": item["faces_after"],
                    "vertices_after": item["vertices_after"],
                }
                for item in self.rounds
            ],
            "rejected_attempts": dict(sorted(self.rejected.items())),
            "remaining_features": self.feature_counts,
            "validation": self.validation,
        }


def _edge_key(first: int, second: int) -> tuple[int, int]:
    return (first, second) if first < second else (second, first)


def _face_edges(face: Face) -> tuple[tuple[int, int], ...]:
    return (
        _edge_key(face[0], face[1]),
        _edge_key(face[1], face[2]),
        _edge_key(face[2], face[0]),
    )


@dataclass(order=True)
class _CollapseCandidate:
    error: float
    sequence: int
    first: int
    second: int
    first_version: int
    second_version: int
    position: Vec3


class _Simplifier:
    def __init__(self, mesh: ObjMesh, options: SimplifyOptions) -> None:
        self.options = options
        self.vertices: dict[int, Vec3] = {
            index: point for index, point in enumerate(mesh.vertices)
        }
        self.faces: dict[int, Face] = {
            index: face for index, face in enumerate(mesh.faces)
        }
        self.face_materials: dict[int, str | None] = {
            index: material
            for index, material in enumerate(mesh.face_materials)
        }
        self.active_vertices: set[int] = {
            index for face in mesh.faces for index in face
        }
        self.vertex_faces: dict[int, set[int]] = {
            index: set() for index in self.active_vertices
        }
        for face_id, face in self.faces.items():
            for vertex_id in face:
                self.vertex_faces[vertex_id].add(face_id)

        self.quadrics: dict[int, Quadric] = {}
        self.versions: dict[int, int] = {
            index: 0 for index in self.active_vertices
        }
        self.heap: list[_CollapseCandidate] = []
        self.sequence = 0
        self.attempted = 0
        self.rejected: Counter[str] = Counter()
        self.lock_reasons: dict[int, set[str]] = {}
        self.protected_edges: set[tuple[int, int]] = set()
        self.feature_counts: dict[str, int] = {}
        self._initial_features: dict[str, int] = {}
        self._initial_topology: dict[str, int] = {}
        self._rounds: list[dict] = []
        self._cumulative_error = 0.0
        self._flip_checks = 0
        self._link_checks = 0
        self._faces_preserved_normals = 0

        self._build_quadrics()
        self._refresh_features()
        self._initial_features = dict(self.feature_counts)
        self._initial_topology = self._topology_signature()
        self._push_all_edges()

    @property
    def face_count(self) -> int:
        return len(self.faces)

    @property
    def active_vertex_count(self) -> int:
        return len(self.active_vertices)

    def _face_quadric(self, face_id: int) -> Quadric:
        face = self.faces[face_id]
        a, b, c = (self.vertices[index] for index in face)
        normal, area = _triangle_area_normal(a, b, c)
        if area <= self.options.min_face_area:
            return Quadric()
        unit = _mul(normal, 1.0 / _length(normal))
        offset = -_dot(unit, a)
        return Quadric.from_plane(unit, offset, area)

    def _build_quadrics(self) -> None:
        quadrics = {index: Quadric() for index in self.active_vertices}
        for face_id in self.faces:
            face_quadric = self._face_quadric(face_id)
            for vertex_id in self.faces[face_id]:
                quadrics[vertex_id] = quadrics[vertex_id] + face_quadric
        self.quadrics = quadrics

    def _recompute_quadrics(self, vertices: Iterable[int]) -> None:
        for vertex_id in vertices:
            if vertex_id not in self.active_vertices:
                continue
            quadric = Quadric()
            for face_id in self.vertex_faces[vertex_id]:
                quadric = quadric + self._face_quadric(face_id)
            self.quadrics[vertex_id] = quadric
            self.versions[vertex_id] += 1

    def _face_unit_normal(self, face_id: int) -> Vec3:
        face = self.faces[face_id]
        a, b, c = (self.vertices[index] for index in face)
        normal, area = _triangle_area_normal(a, b, c)
        if area <= 0.0:
            return (0.0, 0.0, 0.0)
        return _mul(normal, 1.0 / _length(normal))

    def _refresh_features(self) -> None:
        incidence: dict[tuple[int, int], list[int]] = defaultdict(list)
        for face_id, face in self.faces.items():
            for edge in _face_edges(face):
                incidence[edge].append(face_id)

        boundary_edges = 0
        material_edges = 0
        sharp_edges = 0
        nonmanifold_edges = 0
        protected_edges: set[tuple[int, int]] = set()
        reasons: dict[int, set[str]] = defaultdict(set)
        sharp_threshold = self.options.sharp_angle_degrees

        for edge, face_ids in incidence.items():
            edge_reasons: set[str] = set()
            if len(face_ids) == 1:
                boundary_edges += 1
                if self.options.protect_boundary:
                    edge_reasons.add("boundary")
            elif len(face_ids) > 2:
                nonmanifold_edges += 1
                edge_reasons.add("nonmanifold")
            else:
                first_material = self.face_materials[face_ids[0]]
                second_material = self.face_materials[face_ids[1]]
                if first_material != second_material:
                    material_edges += 1
                    if self.options.protect_material:
                        edge_reasons.add("material_seam")
                first_normal = self._face_unit_normal(face_ids[0])
                second_normal = self._face_unit_normal(face_ids[1])
                cosine = max(-1.0, min(1.0, _dot(first_normal, second_normal)))
                angle = math.degrees(math.acos(cosine))
                if angle >= sharp_threshold:
                    sharp_edges += 1
                    if self.options.protect_sharp:
                        edge_reasons.add("sharp")

            if edge_reasons:
                protected_edges.add(edge)
                reasons[edge[0]].update(edge_reasons)
                reasons[edge[1]].update(edge_reasons)

        locked_vertices = sum(1 for item in reasons.values() if item)
        self.lock_reasons = dict(reasons)
        self.protected_edges = protected_edges
        self.feature_counts = {
            "boundary_edges": boundary_edges,
            "material_seam_edges": material_edges,
            "sharp_feature_edges": sharp_edges,
            "nonmanifold_edges": nonmanifold_edges,
            "locked_vertices": locked_vertices,
            "protected_edges": len(protected_edges),
        }

    def _push_edge(self, first: int, second: int) -> None:
        if first == second:
            return
        if first not in self.active_vertices or second not in self.active_vertices:
            return
        if not (self.vertex_faces[first] & self.vertex_faces[second]):
            return
        combined = self.quadrics[first] + self.quadrics[second]
        position, error = _optimal_position(
            combined, self.vertices[first], self.vertices[second]
        )
        self.sequence += 1
        heapq.heappush(
            self.heap,
            _CollapseCandidate(
                error=error,
                sequence=self.sequence,
                first=first,
                second=second,
                first_version=self.versions[first],
                second_version=self.versions[second],
                position=position,
            ),
        )

    def _push_all_edges(self) -> None:
        edges: set[tuple[int, int]] = set()
        for face in self.faces.values():
            edges.update(_face_edges(face))
        for first, second in sorted(edges):
            self._push_edge(first, second)

    def _push_edges_around(self, vertices: Iterable[int]) -> None:
        edges: set[tuple[int, int]] = set()
        for vertex_id in vertices:
            if vertex_id not in self.active_vertices:
                continue
            for face_id in self.vertex_faces[vertex_id]:
                face = self.faces[face_id]
                for other in face:
                    if other != vertex_id:
                        edges.add(_edge_key(vertex_id, other))
        for first, second in sorted(edges):
            self._push_edge(first, second)

    def _edge_faces(self, first: int, second: int) -> set[int]:
        return self.vertex_faces[first] & self.vertex_faces[second]

    def _locked_vertex_reason(self, vertex_id: int) -> str | None:
        reasons = self.lock_reasons.get(vertex_id, set())
        priority = (
            ("boundary", "protected_boundary_vertex"),
            ("material_seam", "protected_material_seam_vertex"),
            ("sharp", "protected_sharp_vertex"),
            ("nonmanifold", "nonmanifold_vertex"),
        )
        for feature, label in priority:
            if feature in reasons:
                return label
        return None

    def _edge_direction(self, face: Face, first: int, second: int) -> int:
        first_position = face.index(first)
        if face[(first_position + 1) % 3] == second:
            return 1
        if face[(first_position - 1) % 3] == second:
            return -1
        return 0

    def _topology_reason(
        self, first: int, second: int, edge_faces: set[int]
    ) -> str | None:
        if len(edge_faces) != 2:
            return "nonmanifold_edge"

        directions = {
            self._edge_direction(self.faces[face_id], first, second)
            for face_id in edge_faces
        }
        if 0 in directions or len(directions) != 2:
            return "nonmanifold_orientation"

        opposites: set[int] = set()
        for face_id in edge_faces:
            opposites.update(set(self.faces[face_id]) - {first, second})
        if len(opposites) != 2:
            return "topology_link_condition"

        first_link: set[int] = set()
        for face_id in self.vertex_faces[first]:
            first_link.update(self.faces[face_id])
        first_link.discard(first)
        first_link.discard(second)

        second_link: set[int] = set()
        for face_id in self.vertex_faces[second]:
            second_link.update(self.faces[face_id])
        second_link.discard(first)
        second_link.discard(second)

        if first_link & second_link != opposites:
            return "topology_link_condition"

        resulting_faces: set[frozenset[int]] = set()
        for face_id in self.vertex_faces[first] | self.vertex_faces[second]:
            if face_id in edge_faces:
                continue
            face = frozenset(
                first if vertex_id == second else vertex_id
                for vertex_id in self.faces[face_id]
            )
            if len(face) != 3:
                return "topology_degenerate_face"
            if face in resulting_faces:
                return "topology_duplicate_face"
            resulting_faces.add(face)

        self._link_checks += 1
        return None

    def _flip_reason(
        self, first: int, second: int, new_position: Vec3, edge_faces: set[int]
    ) -> str | None:
        preserved = 0
        for face_id in self.vertex_faces[first] | self.vertex_faces[second]:
            if face_id in edge_faces:
                continue
            face = self.faces[face_id]
            old_points = [self.vertices[index] for index in face]
            old_normal, old_area = _triangle_area_normal(*old_points)
            if old_area <= self.options.min_face_area:
                return "degenerate_face"

            new_points = [
                new_position if index in (first, second) else self.vertices[index]
                for index in face
            ]
            new_normal, new_area = _triangle_area_normal(*new_points)
            if new_area <= self.options.min_face_area:
                return "degenerate_face"

            cosine = _dot(old_normal, new_normal) / (
                _length(old_normal) * _length(new_normal)
            )
            if cosine < self.options.min_normal_dot:
                return "face_flip"
            preserved += 1
        self._flip_checks += 1
        self._faces_preserved_normals += preserved
        return None

    def _constraint_reason(
        self,
        first: int,
        second: int,
        position: Vec3,
        error: float,
        edge_faces: set[int],
    ) -> str | None:
        for vertex_id in (first, second):
            reason = self._locked_vertex_reason(vertex_id)
            if reason is not None:
                return reason

        topology_reason = self._topology_reason(first, second, edge_faces)
        if topology_reason is not None:
            return topology_reason

        if self.options.max_error is not None and error > self.options.max_error:
            return "max_error_exceeded"

        return self._flip_reason(first, second, position, edge_faces)

    def _collapse(
        self,
        first: int,
        second: int,
        position: Vec3,
        error: float,
        edge_faces: set[int],
    ) -> tuple[dict, set[int]]:
        faces_before = self.face_count
        vertices_before = self.active_vertex_count
        old_first = self.vertices[first]
        old_second = self.vertices[second]

        touched_faces = self.vertex_faces[first] | self.vertex_faces[second]
        source_faces = sorted(touched_faces)
        source_materials = sorted(
            {
                self.face_materials[face_id]
                for face_id in source_faces
                if self.face_materials[face_id] is not None
            }
        )
        source_face_records = [
            {
                "face_id": face_id,
                "vertices": list(self.faces[face_id]),
                "material": self.face_materials[face_id],
            }
            for face_id in source_faces
        ]
        affected: set[int] = set()
        for face_id in touched_faces:
            affected.update(self.faces[face_id])

        removed_faces: list[dict] = []
        for face_id in sorted(edge_faces):
            record = {
                "face_id": face_id,
                "vertices": list(self.faces[face_id]),
                "material": self.face_materials[face_id],
            }
            removed_faces.append(record)
            for vertex_id in self.faces[face_id]:
                self.vertex_faces[vertex_id].discard(face_id)
            del self.faces[face_id]
            del self.face_materials[face_id]

        moved_faces = sorted(self.vertex_faces[second])
        for face_id in moved_faces:
            face = self.faces[face_id]
            self.faces[face_id] = tuple(
                first if vertex_id == second else vertex_id for vertex_id in face
            )  # type: ignore[assignment]
            self.vertex_faces[first].add(face_id)

        self.vertex_faces.pop(second)
        self.active_vertices.remove(second)
        self.vertices[first] = position
        self.quadrics.pop(second, None)
        self.versions.pop(second, None)
        self._recompute_quadrics(affected)

        self._cumulative_error += error
        history = {
            "round": len(self._rounds) + 1,
            "edge": [first, second],
            "kept_vertex": first,
            "removed_vertex": second,
            "old_positions": [list(old_first), list(old_second)],
            "new_position": list(position),
            "quadric_error": error,
            "cumulative_error": self._cumulative_error,
            "faces_before": faces_before,
            "faces_after": self.face_count,
            "vertices_before": vertices_before,
            "vertices_after": self.active_vertex_count,
            "removed_faces": removed_faces,
            "source_faces": source_faces,
            "source_face_records": source_face_records,
            "source_materials": source_materials,
            "checks": {
                "edge_manifold": "passed",
                "link_condition": "passed",
                "face_flip": "passed",
                "degenerate_face": "passed",
            },
        }
        self._rounds.append(history)
        return history, affected

    def _topology_signature(self) -> dict[str, int]:
        edge_incidence: dict[tuple[int, int], int] = defaultdict(int)
        vertex_adjacency: dict[int, set[int]] = {
            vertex_id: set() for vertex_id in self.active_vertices
        }
        for face in self.faces.values():
            for edge in _face_edges(face):
                edge_incidence[edge] += 1
                vertex_adjacency[edge[0]].add(edge[1])
                vertex_adjacency[edge[1]].add(edge[0])

        components = 0
        unvisited = set(self.active_vertices)
        while unvisited:
            components += 1
            stack = [unvisited.pop()]
            while stack:
                current = stack.pop()
                for neighbor in vertex_adjacency[current]:
                    if neighbor in unvisited:
                        unvisited.remove(neighbor)
                        stack.append(neighbor)

        boundary_graph: dict[int, set[int]] = defaultdict(set)
        boundary_edges = 0
        nonmanifold_edges = 0
        for (first, second), count in edge_incidence.items():
            if count == 1:
                boundary_edges += 1
                boundary_graph[first].add(second)
                boundary_graph[second].add(first)
            elif count > 2:
                nonmanifold_edges += 1

        boundary_loops = 0
        unvisited_boundary = set(boundary_graph)
        while unvisited_boundary:
            boundary_loops += 1
            stack = [unvisited_boundary.pop()]
            while stack:
                current = stack.pop()
                for neighbor in boundary_graph[current]:
                    if neighbor in unvisited_boundary:
                        unvisited_boundary.remove(neighbor)
                        stack.append(neighbor)

        return {
            "vertices": self.active_vertex_count,
            "edges": len(edge_incidence),
            "faces": self.face_count,
            "euler_characteristic": (
                self.active_vertex_count - len(edge_incidence) + self.face_count
            ),
            "components": components,
            "boundary_edges": boundary_edges,
            "boundary_loops": boundary_loops,
            "nonmanifold_edges": nonmanifold_edges,
        }

    @staticmethod
    def _topology_identity(signature: dict[str, int]) -> dict[str, int]:
        return {
            key: signature[key]
            for key in (
                "euler_characteristic",
                "components",
                "boundary_edges",
                "boundary_loops",
                "nonmanifold_edges",
            )
        }

    def _stop_detail(self) -> str:
        counts = self.feature_counts
        rejected = ", ".join(
            f"{reason}={count}" for reason, count in sorted(self.rejected.items())
        )
        if not rejected:
            rejected = "none"
        return (
            f"Stopped at {self.face_count} faces (target {self.options.target_faces}) "
            "because no legal collapse remained. "
            f"Locked features: boundary_edges={counts['boundary_edges']}, "
            f"material_seam_edges={counts['material_seam_edges']}, "
            f"sharp_feature_edges={counts['sharp_feature_edges']}, "
            f"locked_vertices={counts['locked_vertices']}. "
            f"Rejected attempts: {rejected}."
        )

    def _compact(self) -> tuple[list[Vec3], list[Face], list[str | None]]:
        used = sorted({vertex_id for face in self.faces.values() for vertex_id in face})
        remap = {vertex_id: index for index, vertex_id in enumerate(used)}
        vertices = [self.vertices[vertex_id] for vertex_id in used]
        face_ids = sorted(self.faces)
        faces = [
            tuple(remap[vertex_id] for vertex_id in self.faces[face_id])
            for face_id in face_ids
        ]
        materials = [self.face_materials[face_id] for face_id in face_ids]
        return vertices, faces, materials  # type: ignore[return-value]

    def run(self) -> SimplifyResult:
        target = self.options.target_faces
        if self.face_count <= target:
            stop_reason = "target_already_met"
            stop_detail = (
                f"Input already has {self.face_count} faces, at or below target {target}."
            )
        else:
            stop_reason = "constraints_exhausted"
            stop_detail = ""
            while self.face_count > target and self.heap:
                candidate = heapq.heappop(self.heap)
                if candidate.first not in self.active_vertices:
                    continue
                if candidate.second not in self.active_vertices:
                    continue
                if candidate.first_version != self.versions[candidate.first]:
                    continue
                if candidate.second_version != self.versions[candidate.second]:
                    continue

                edge_faces = self._edge_faces(candidate.first, candidate.second)
                if not edge_faces:
                    continue
                self.attempted += 1
                reason = self._constraint_reason(
                    candidate.first,
                    candidate.second,
                    candidate.position,
                    candidate.error,
                    edge_faces,
                )
                if reason is not None:
                    self.rejected[reason] += 1
                    continue

                _, affected = self._collapse(
                    candidate.first,
                    candidate.second,
                    candidate.position,
                    candidate.error,
                    edge_faces,
                )
                self._refresh_features()
                self._push_edges_around(affected)

            if self.face_count <= target:
                stop_reason = "target_faces_reached"
                stop_detail = (
                    f"Reached {self.face_count} faces after "
                    f"{len(self._rounds)} accepted collapses."
                )
            else:
                stop_detail = self._stop_detail()

        vertices, faces, materials = self._compact()
        final_topology = self._topology_signature()
        topology_preserved = (
            self._topology_identity(self._initial_topology)
            == self._topology_identity(final_topology)
        )
        validation = {
            "target_faces": target,
            "topology_initial": self._initial_topology,
            "topology_final": final_topology,
            "topology_preserved": topology_preserved,
            "link_condition_checks_passed": self._link_checks,
            "flip_checks_passed": self._flip_checks,
            "face_normals_checked_preserved": self._faces_preserved_normals,
            "boundary_edges_preserved": (
                self.feature_counts["boundary_edges"]
                == self._initial_features["boundary_edges"]
            ),
            "material_seam_edges_preserved": (
                self.feature_counts["material_seam_edges"]
                == self._initial_features["material_seam_edges"]
            ),
            "sharp_feature_edges_preserved": (
                self.feature_counts["sharp_feature_edges"]
                == self._initial_features["sharp_feature_edges"]
            ),
        }
        return SimplifyResult(
            vertices=vertices,
            faces=faces,
            face_materials=materials,
            initial_vertex_count=len(self.vertices),
            initial_face_count=self._initial_topology["faces"],
            final_vertex_count=len(vertices),
            final_face_count=len(faces),
            stop_reason=stop_reason,
            stop_detail=stop_detail,
            rounds=self._rounds,
            rejected=self.rejected,
            feature_counts=self.feature_counts,
            validation=validation,
        )


def simplify_mesh(mesh: ObjMesh, options: SimplifyOptions) -> SimplifyResult:
    return _Simplifier(mesh, options).run()
