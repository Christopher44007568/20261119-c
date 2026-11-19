"""三角网格数据结构与示例网格。"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .aabb import AABB
from .vec import Vec3


@dataclass
class Mesh:
    vertices: list[Vec3]
    triangles: list[tuple[int, int, int]]
    name: str = "mesh"

    def tri_points(self, tri_id: int) -> tuple[Vec3, Vec3, Vec3]:
        a, b, c = self.triangles[tri_id]
        return self.vertices[a], self.vertices[b], self.vertices[c]

    def tri_box(self, tri_id: int) -> AABB:
        return AABB.from_points(self.tri_points(tri_id))

    def bounds(self) -> AABB:
        return AABB.from_points(self.vertices)

    def move_vertex(self, index: int, new_pos: Vec3) -> None:
        """移动单个顶点。调用方负责之后对 BVH 执行 refit。"""
        self.vertices[index] = tuple(float(v) for v in new_pos)

    def displace(self, fn) -> None:
        """对每个顶点施加 fn(p) -> Vec3 的形变，用于 refit 压力场景。"""
        self.vertices = [fn(p) for p in self.vertices]


def make_cube(half: float = 1.0) -> Mesh:
    """单位立方体，每面两个三角形，共 12 个三角形（面不共享顶点）。"""
    h = half
    corners = [
        (-h, -h, -h), (h, -h, -h), (h, h, -h), (-h, h, -h),
        (-h, -h, h), (h, -h, h), (h, h, h), (-h, h, h),
    ]
    faces = [
        (0, 3, 2), (0, 2, 1),  # -z
        (4, 5, 6), (4, 6, 7),  # +z
        (0, 1, 5), (0, 5, 4),  # -y
        (3, 7, 6), (3, 6, 2),  # +y
        (0, 4, 7), (0, 7, 3),  # -x
        (1, 2, 6), (1, 6, 5),  # +x
    ]
    return Mesh(vertices=[c for c in corners], triangles=faces, name="cube")


def make_grid(nx: int = 8, nz: int = 8, size: float = 2.0) -> Mesh:
    """xz 平面上的细分网格面，共 (nx*nz)*2 个三角形。"""
    verts: list[Vec3] = []
    for iz in range(nz + 1):
        for ix in range(nx + 1):
            x = -size + 2 * size * ix / nx
            z = -size + 2 * size * iz / nz
            verts.append((x, 0.0, z))
    tris: list[tuple[int, int, int]] = []
    row = nx + 1
    for iz in range(nz):
        for ix in range(nx):
            p = iz * row + ix
            tris.append((p, p + row, p + 1))
            tris.append((p + 1, p + row, p + row + 1))
    return Mesh(verts, tris, name=f"grid_{nx}x{nz}")


def make_uv_sphere(radius: float = 1.0, sectors: int = 16, stacks: int = 10) -> Mesh:
    """UV 球，极点为独立顶点，便于后续移动顶点制造形变。"""
    verts: list[Vec3] = []
    for i in range(stacks + 1):
        phi = math.pi * i / stacks
        for j in range(sectors):
            theta = 2 * math.pi * j / sectors
            verts.append(
                (
                    -radius * math.cos(theta) * math.sin(phi),
                    radius * math.cos(phi),
                    radius * math.sin(theta) * math.sin(phi),
                )
            )
    tris: list[tuple[int, int, int]] = []
    row = sectors
    for i in range(stacks):
        for j in range(sectors):
            p = i * row + j
            q = i * row + (j + 1) % sectors
            tris.append((p, p + row, q + row))
            tris.append((p, q + row, q))
    return Mesh(verts, tris, name=f"sphere_s{sectors}_t{stacks}")
