"""Surface decal system: geometric projection onto undulating receivers."""

from .mesh import TriangleMesh
from .projector import (
    DecalDefinition,
    DecalPatch,
    ProjectionReport,
    project_decal,
)
from .system import DecalSystem

__all__ = [
    "TriangleMesh",
    "DecalDefinition",
    "DecalPatch",
    "ProjectionReport",
    "project_decal",
    "DecalSystem",
]
