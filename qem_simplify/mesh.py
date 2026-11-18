from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


Vec3 = tuple[float, float, float]
Face = tuple[int, int, int]


@dataclass
class ObjMesh:
    vertices: list[Vec3] = field(default_factory=list)
    faces: list[Face] = field(default_factory=list)
    face_materials: list[str | None] = field(default_factory=list)
    mtllib: str | None = None
    object_name: str | None = None

    def __post_init__(self) -> None:
        if len(self.face_materials) != len(self.faces):
            raise ValueError("face_materials must have one entry per face")

    @property
    def vertex_count(self) -> int:
        return len(self.vertices)

    @property
    def face_count(self) -> int:
        return len(self.faces)


def _parse_float_tuple(parts: list[str], count: int) -> tuple[float, ...]:
    if len(parts) < count:
        raise ValueError(f"expected at least {count} coordinates, got {len(parts)}")
    return tuple(float(value) for value in parts[:count])


def _parse_face_index(token: str, vertex_count: int) -> int:
    raw = token.split("/", 1)[0]
    if not raw:
        raise ValueError(f"invalid face token {token!r}")
    index = int(raw)
    if index == 0:
        raise ValueError("OBJ indices are one-based and cannot be zero")
    resolved = index - 1 if index > 0 else vertex_count + index
    if resolved < 0 or resolved >= vertex_count:
        raise ValueError(f"face index {index} is out of range")
    return resolved


def load_obj(path: str | Path) -> ObjMesh:
    """Load an OBJ file, triangulating polygon faces with a fan."""

    path = Path(path)
    vertices: list[Vec3] = []
    faces: list[Face] = []
    face_materials: list[str | None] = []
    mtllib: str | None = None
    object_name: str | None = None
    current_material: str | None = None

    with path.open("r", encoding="utf-8-sig") as handle:
        for line_number, raw_line in enumerate(handle, 1):
            line = raw_line.split("#", 1)[0].strip()
            if not line:
                continue
            parts = line.split()
            keyword = parts[0]
            try:
                if keyword == "v":
                    vertices.append(_parse_float_tuple(parts[1:], 3))  # type: ignore[arg-type]
                elif keyword == "f":
                    indices = [
                        _parse_face_index(token, len(vertices))
                        for token in parts[1:]
                    ]
                    if len(indices) < 3:
                        raise ValueError("a face needs at least three vertices")
                    for offset in range(1, len(indices) - 1):
                        faces.append(
                            (indices[0], indices[offset], indices[offset + 1])
                        )
                        face_materials.append(current_material)
                elif keyword == "usemtl":
                    current_material = " ".join(parts[1:]) or None
                elif keyword == "mtllib" and mtllib is None:
                    mtllib = " ".join(parts[1:]) or None
                elif keyword == "o" and object_name is None:
                    object_name = " ".join(parts[1:]) or None
            except ValueError as exc:
                raise ValueError(f"{path}:{line_number}: {exc}") from exc

    return ObjMesh(
        vertices=vertices,
        faces=faces,
        face_materials=face_materials,
        mtllib=mtllib,
        object_name=object_name,
    )


def _format_number(value: float) -> str:
    return f"{value:.10g}"


def save_obj(
    path: str | Path,
    vertices: list[Vec3],
    faces: list[Face],
    face_materials: list[str | None] | None = None,
    *,
    mtllib: str | None = None,
    object_name: str | None = None,
) -> None:
    """Write a compact OBJ containing only referenced vertices."""

    if face_materials is None:
        face_materials = [None] * len(faces)
    if len(face_materials) != len(faces):
        raise ValueError("face_materials must have one entry per face")
    for face in faces:
        if len(set(face)) != 3:
            raise ValueError(f"degenerate face cannot be exported: {face}")
        if any(index < 0 or index >= len(vertices) for index in face):
            raise ValueError(f"face references a missing vertex: {face}")

    used = sorted({index for face in faces for index in face})
    remap = {old: new for new, old in enumerate(used)}
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("# Feature-preserving QEM simplification output\n")
        if mtllib:
            handle.write(f"mtllib {mtllib}\n")
        if object_name:
            handle.write(f"o {object_name}\n")
        for old_index in used:
            x, y, z = vertices[old_index]
            handle.write(
                f"v {_format_number(x)} {_format_number(y)} {_format_number(z)}\n"
            )

        previous_material: str | None | object = object()
        for face, material in zip(faces, face_materials):
            if material != previous_material:
                if material is not None:
                    handle.write(f"usemtl {material}\n")
                previous_material = material
            a, b, c = (remap[index] + 1 for index in face)
            handle.write(f"f {a} {b} {c}\n")
