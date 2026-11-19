"""2D linear elasticity FEM solver on triangular meshes (CST, plane stress)."""

from .mesh import make_rect_mesh
from .core import (
    Material,
    SingularSystemError,
    assemble_stiffness,
    solve,
    reaction_forces,
    element_strains,
    element_stresses,
)

__all__ = [
    "make_rect_mesh",
    "Material",
    "SingularSystemError",
    "assemble_stiffness",
    "solve",
    "reaction_forces",
    "element_strains",
    "element_stresses",
]
