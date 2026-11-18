"""Feature-preserving quadric-error mesh simplification."""

from .mesh import ObjMesh, load_obj, save_obj
from .simplify import SimplifyOptions, SimplifyResult, simplify_mesh

__all__ = [
    "ObjMesh",
    "SimplifyOptions",
    "SimplifyResult",
    "load_obj",
    "save_obj",
    "simplify_mesh",
]

