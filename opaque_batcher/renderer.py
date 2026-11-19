"""Two render front-ends over one rasterizer.

render_per_object: one draw call per visible opaque object (reference).
render_batched:    one draw call per non-empty (mesh, material) batch,
                   iterating the packed instance buffer.

Both call raster.draw_mesh with identical arguments for every instance,
so color and pick render targets must match bit for bit.
"""

from __future__ import annotations

from dataclasses import dataclass

from .batcher import INSTANCE_STRIDE, OpaqueBatcher, unpack_instance
from .mesh import MeshLibrary
from .raster import FrameBuffer, draw_mesh
from .scene import Scene


@dataclass
class RenderStats:
    draw_calls: int
    instances: int
    triangles_drawn: int


def render_per_object(fb: FrameBuffer, scene: Scene, meshes: MeshLibrary,
                      batcher: OpaqueBatcher,
                      view_scale: float) -> RenderStats:
    draw_calls = 0
    triangles = 0
    for instance in sorted(scene.visible_instances(),
                           key=lambda item: item.pick_id):
        mesh = meshes.get(instance.mesh_name)
        color = batcher.material_color(instance.material_id)
        triangles += draw_mesh(fb, mesh, instance, color, view_scale)
        draw_calls += 1
    return RenderStats(draw_calls, draw_calls, triangles)


def render_batched(fb: FrameBuffer, meshes: MeshLibrary,
                   batcher: OpaqueBatcher,
                   view_scale: float) -> RenderStats:
    draw_calls = 0
    instances = 0
    triangles = 0
    for batch in batcher.batches():
        mesh = meshes.get(batch.mesh_name)
        color = batcher.material_color(batch.material_id)
        for slot in range(batch.size):
            packed, _offset = unpack_instance(batch.buffer, slot)
            packed.mesh_name = batch.mesh_name
            triangles += draw_mesh(fb, mesh, packed, color, view_scale)
            instances += 1
        draw_calls += 1
    return RenderStats(draw_calls, instances, triangles)


def compare_targets(reference: FrameBuffer, candidate: FrameBuffer
                    ) -> tuple[int, int]:
    """Count mismatched color pixels and mismatched pick pixels."""
    color_mismatch = 0
    pick_mismatch = 0
    count = reference.width * reference.height
    for idx in range(count):
        off = idx * 3
        if reference.color[off:off + 3] != candidate.color[off:off + 3]:
            color_mismatch += 1
        if reference.pick[idx] != candidate.pick[idx]:
            pick_mismatch += 1
    return color_mismatch, pick_mismatch


def instance_stride() -> int:
    return INSTANCE_STRIDE
