"""OBJ export for swept meshes and frame gizmos.

The mesh writer emits per-face groups so body/cap faces are easy to inspect.
Frame gizmos use line elements split into three objects (normal/binormal/
tangent), with a companion ``.mtl`` file carrying axis colors.
"""

from __future__ import annotations
import os

from .frame import Frame
from .mesh import Mesh
from .vector import add, scale


def write_obj(mesh: Mesh, path: str) -> str:
    lines = [f"# swept tube mesh: {len(mesh.vertices)} verts, "
             f"{len(mesh.faces)} faces"]
    for x, y, z in mesh.vertices:
        lines.append(f"v {x:.6f} {y:.6f} {z:.6f}")
    if not mesh.groups:
        lines.extend(_face_lines(mesh, 0, len(mesh.faces)))
    else:
        for name, start, end in mesh.groups:
            lines.append(f"g {name}")
            lines.extend(_face_lines(mesh, start, end))
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    return path


def _face_lines(mesh: Mesh, start: int, end: int) -> list[str]:
    out = []
    for face in mesh.faces[start:end]:
        # OBJ indices are 1-based.
        out.append("f " + " ".join(str(i + 1) for i in face))
    return out


def write_frames_obj(frames: list[Frame], path: str, axis_length: float = 0.6) -> str:
    """Write frame axes as colored line objects plus an MTL sidecar."""
    base, _ext = os.path.splitext(path)
    mtl_path = base + ".mtl"
    lines = [f"mtllib {os.path.basename(mtl_path)}"]
    specs = [
        ("tangent", lambda f: f.tangent, (0.85, 0.2, 0.2)),
        ("normal", lambda f: f.normal, (0.2, 0.7, 0.25)),
        ("binormal", lambda f: f.binormal, (0.25, 0.4, 0.9)),
    ]
    for name, accessor, color in specs:
        lines.append(f"o frame_{name}")
        lines.append(f"usemtl {name}")
        for frame in frames:
            tip = add(frame.position, scale(accessor(frame), axis_length))
            lines.append(f"v {frame.position[0]:.6f} {frame.position[1]:.6f} "
                         f"{frame.position[2]:.6f}")
            lines.append(f"v {tip[0]:.6f} {tip[1]:.6f} {tip[2]:.6f}")
    vertex_index = 1
    for name, _accessor, _color in specs:
        lines.append(f"o lines_{name}")
        for _frame in frames:
            lines.append(f"l {vertex_index} {vertex_index + 1}")
            vertex_index += 2
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    mtl = []
    for name, _accessor, color in specs:
        mtl.append(f"newmtl {name}")
        mtl.append(f"Kd {color[0]} {color[1]} {color[2]}")
        mtl.append("Ka 0 0 0")
    with open(mtl_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(mtl) + "\n")
    return path
