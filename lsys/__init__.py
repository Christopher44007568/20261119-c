"""Deterministic L-system branching structure generator.

Pure standard-library implementation:

* :mod:`lsys.parser`     - grammar parser with symbol-position syntax errors
* :mod:`lsys.expander`   - provenance-tracked expansion with size estimation
* :mod:`lsys.turtle`     - 3D turtle with a continuous orthonormal frame
* :mod:`lsys.mesh`       - tube sweep, welding, caps and OBJ export
* :mod:`lsys.validate`   - twist / crack / frame integrity checks
* :mod:`lsys.export`     - derivation tree, manifest and SVG export

Everything is generated procedurally from the grammar; no external tree
models are loaded and no random scattering is performed.
"""

from .errors import LSystemError, LSystemSyntaxError
from .parser import Grammar, Token, parse_grammar
from .expander import ExpandedToken, expand, estimate_expansion
from .turtle import TurtleResult, run_turtle
from .mesh import build_mesh
from .validate import validate_result

__all__ = [
    "LSystemError",
    "LSystemSyntaxError",
    "Grammar",
    "Token",
    "parse_grammar",
    "ExpandedToken",
    "expand",
    "estimate_expansion",
    "run_turtle",
    "TurtleResult",
    "build_mesh",
    "validate_result",
]
