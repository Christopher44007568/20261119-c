"""Procedural triangle meshes for the software rasterizer.

A mesh stores local-space vertices and triangles with an explicit outward
flat-shading normal per triangle. The only built-in mesh is a unit cube.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Triangle:
    i0: int
    i1: int
    i2: int
    normal: tuple[float, float, float]


@dataclass
class Mesh:
    name: str
    vertices: tuple[tuple[float, float, float], ...]
    triangles: tuple[Triangle, ...]


def make_cube(name: str = "cube") -> Mesh:
    vertices = (
        (-0.5, -0.5, -0.5),  # 0
        (0.5, -0.5, -0.5),   # 1
        (0.5, 0.5, -0.5),    # 2
        (-0.5, 0.5, -0.5),   # 3
        (-0.5, -0.5, 0.5),   # 4
        (0.5, -0.5, 0.5),    # 5
        (0.5, 0.5, 0.5),     # 6
        (-0.5, 0.5, 0.5),    # 7
    )
    triangles = (
        Triangle(4, 5, 6, (0.0, 0.0, 1.0)),
        Triangle(4, 6, 7, (0.0, 0.0, 1.0)),
        Triangle(0, 3, 2, (0.0, 0.0, -1.0)),
        Triangle(0, 2, 1, (0.0, 0.0, -1.0)),
        Triangle(3, 7, 6, (0.0, 1.0, 0.0)),
        Triangle(3, 6, 2, (0.0, 1.0, 0.0)),
        Triangle(0, 1, 5, (0.0, -1.0, 0.0)),
        Triangle(0, 5, 4, (0.0, -1.0, 0.0)),
        Triangle(1, 2, 6, (1.0, 0.0, 0.0)),
        Triangle(1, 6, 5, (1.0, 0.0, 0.0)),
        Triangle(0, 4, 7, (-1.0, 0.0, 0.0)),
        Triangle(0, 7, 3, (-1.0, 0.0, 0.0)),
    )
    return Mesh(name, vertices, triangles)


class MeshLibrary:
    def __init__(self) -> None:
        self._meshes: dict[str, Mesh] = {}

    def add(self, mesh: Mesh) -> None:
        self._meshes[mesh.name] = mesh

    def get(self, name: str) -> Mesh:
        return self._meshes[name]
