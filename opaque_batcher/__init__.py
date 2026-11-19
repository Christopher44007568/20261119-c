"""Opaque-instance material batching with incremental buffer updates.

Submodules:
    material: stable material IDs and a material registry.
    scene:    opaque object instances with per-object pick IDs.
    mesh:     procedural cube mesh used by the software rasterizer.
    batcher:  stable-ID batch merging and incremental upload accounting.
    raster:   deterministic depth-buffered software rasterizer.
    renderer: per-object reference path and batched path.
"""

from .material import Material, MaterialRegistry
from .scene import Scene, Instance
from .batcher import OpaqueBatcher, INSTANCE_STRIDE, MATERIAL_STRIDE
from .renderer import render_per_object, render_batched, RenderStats
from .raster import FrameBuffer

__all__ = [
    "Material",
    "MaterialRegistry",
    "Scene",
    "Instance",
    "OpaqueBatcher",
    "INSTANCE_STRIDE",
    "MATERIAL_STRIDE",
    "render_per_object",
    "render_batched",
    "RenderStats",
    "FrameBuffer",
]
