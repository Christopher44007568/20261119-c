"""Error types with precise symbol-position reporting."""

from __future__ import annotations


class LSystemError(Exception):
    """Base class for all generator errors."""


class LSystemSyntaxError(LSystemError):
    """Syntax error located at a specific symbol in the grammar source.

    Attributes carry 1-based line/column information plus the source line so
    callers can render a caret pointing at the offending symbol.
    """

    def __init__(self, message: str, line: int, column: int,
                 source_line: str = "", offset: int = -1) -> None:
        self.message = message
        self.line = line
        self.column = column
        self.source_line = source_line
        self.offset = offset
        super().__init__(self.render())

    def render(self) -> str:
        header = f"[line {self.line}:{self.column}] syntax error: {self.message}"
        if not self.source_line:
            return header
        caret = " " * (self.column - 1) + "^"
        return f"{header}\n  {self.source_line}\n  {caret}"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.render()


class ExpansionLimitError(LSystemError):
    """Raised when an expansion would exceed the configured safety limits."""


class GeometryLimitError(LSystemError):
    """Raised when mesh generation would exceed configured safety limits."""
