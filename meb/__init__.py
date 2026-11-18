"""Minimum enclosing ball (MEB) for 3D triangle-mesh vertices.

- exact:  Welzl's algorithm (small data)
- approx: Badoiu-Clarkson core-set algorithm (large data), radius expanded
          so the ball always contains every point
- dynamic: incremental maintenance under batched add/move/remove of vertices
"""

from .core import Ball, ball_from_support, containment_error
from .exact import meb_exact
from .approx import meb_approx
from .dynamic import DynamicMEB
from .compare import Comparison

__all__ = [
    "Ball",
    "ball_from_support",
    "containment_error",
    "meb_exact",
    "meb_approx",
    "DynamicMEB",
    "Comparison",
]
