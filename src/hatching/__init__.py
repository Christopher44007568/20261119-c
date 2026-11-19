"""Curvature-driven surface hatching on triangle meshes.

Pipeline:
  mesh -> local quadratic curvature estimate -> principal direction field
  -> stable fallback field for flat / near-umbilic regions
  -> object-space streamline tracing on the triangulated surface
  -> tone-layered hatching seeded from a fixed object-space light
  -> line-length / break reports and 3D visualisations.

All hatching geometry is traced on the surface in object space; no screen
space stripe texture is ever used.
"""

__all__ = [
    "mesh",
    "curvature",
    "field",
    "shading",
    "streamlines",
    "analytics",
    "report",
    "visualize",
    "pipeline",
]
