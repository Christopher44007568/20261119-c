"""Deterministic software depth-buffer rasterizer.

The rasterizer is shared unchanged by the per-object reference path and the
batched path, which is what lets the test suite prove pixel-identical
output. Both paths emit the same triangles with the same float arithmetic;
depth ties are broken by pick ID so submission order never affects the
final image.
"""

from __future__ import annotations

from array import array

from .mesh import Mesh
from .scene import Instance


class FrameBuffer:
    def __init__(self, width: int, height: int) -> None:
        self.width = width
        self.height = height
        pixel_count = width * height
        self.color = bytearray(pixel_count * 3)
        self.depth = array("f", [float("-inf")] * pixel_count)
        self.pick = array("I", [0] * pixel_count)

    def clear(self) -> None:
        self.color[:] = b"\x00" * len(self.color)
        inf = float("-inf")
        for i in range(self.width * self.height):
            self.depth[i] = inf
            self.pick[i] = 0

    def signature(self) -> bytes:
        return bytes(self.color) + bytes(self.pick)


def _quantize(value: float) -> int:
    quantized = int(value * 255.0 + 0.5)
    return max(0, min(255, quantized))


def _world_vertices(mesh: Mesh, instance: Instance
                     ) -> list[tuple[float, float, float]]:
    px, py, pz = instance.position
    scale = instance.scale
    return [
        (vx * scale + px, vy * scale + py, vz * scale + pz)
        for vx, vy, vz in mesh.vertices
    ]


def draw_mesh(fb: FrameBuffer, mesh: Mesh, instance: Instance,
              material_color: tuple[float, float, float],
              view_scale: float) -> int:
    """Rasterize one instance; returns number of triangles drawn."""
    world = _world_vertices(mesh, instance)
    half_w = fb.width * 0.5
    half_h = fb.height * 0.5
    light = (0.384, 0.576, 0.722)
    ambient = 0.25
    diffuse_gain = 0.75
    drawn = 0

    for tri in mesh.triangles:
        nx, ny, nz = tri.normal
        if nz <= 0.0:
            continue
        shade = (ambient + diffuse_gain * max(
            0.0, nx * light[0] + ny * light[1] + nz * light[2]))
        r = _quantize(material_color[0] * shade)
        g = _quantize(material_color[1] * shade)
        b = _quantize(material_color[2] * shade)

        p0 = world[tri.i0]
        p1 = world[tri.i1]
        p2 = world[tri.i2]
        x0, y0, z0 = p0[0] * view_scale + half_w, half_h - p0[1] * view_scale, p0[2]
        x1, y1, z1 = p1[0] * view_scale + half_w, half_h - p1[1] * view_scale, p1[2]
        x2, y2, z2 = p2[0] * view_scale + half_w, half_h - p2[1] * view_scale, p2[2]

        denom = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if denom == 0.0:
            continue
        inv_denom = 1.0 / denom

        min_x = max(0, int(min(x0, x1, x2)))
        max_x = min(fb.width - 1, int(max(x0, x1, x2)))
        min_y = max(0, int(min(y0, y1, y2)))
        max_y = min(fb.height - 1, int(max(y0, y1, y2)))

        for py in range(min_y, max_y + 1):
            sy = py + 0.5
            row = py * fb.width
            for px in range(min_x, max_x + 1):
                sx = px + 0.5
                w0 = ((y1 - y2) * sx + (x2 - x1) * sy
                      + x1 * y2 - x2 * y1) * inv_denom
                w1 = ((y2 - y0) * sx + (x0 - x2) * sy
                      + x2 * y0 - x0 * y2) * inv_denom
                if w0 < 0.0 or w1 < 0.0:
                    continue
                w2 = 1.0 - w0 - w1
                if w2 < 0.0:
                    continue
                z = w0 * z0 + w1 * z1 + w2 * z2
                idx = row + px
                stored = fb.depth[idx]
                if z > stored or (z == stored and instance.pick_id > fb.pick[idx]):
                    fb.depth[idx] = z
                    fb.pick[idx] = instance.pick_id
                    off = idx * 3
                    fb.color[off] = r
                    fb.color[off + 1] = g
                    fb.color[off + 2] = b
        drawn += 1
    return drawn
