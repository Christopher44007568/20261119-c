"""Sweep surface modeler with parallel-transport frames."""

from .frame import Frame, frame_orthogonality_error, frenet_normals, parallel_transport_frames
from .mesh import Mesh, SweepConfig, build_sweep
from .path import Path
from .section import Section, SectionError, circle_section, rectangle_section
from .validate import ValidationReport, validate_mesh

__all__ = [
    "Frame",
    "Mesh",
    "Path",
    "Section",
    "SectionError",
    "SweepConfig",
    "build_sweep",
    "circle_section",
    "frame_orthogonality_error",
    "frenet_normals",
    "parallel_transport_frames",
    "rectangle_section",
    "validate_mesh",
    "ValidationReport",
]
