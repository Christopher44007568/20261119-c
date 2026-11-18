"""Strict parser/writer for a clearly declared subset of the .cube LUT format.

Supported subset
----------------
    TITLE "..."            optional, at most once, before any data
    LUT_1D_SIZE <n>        exactly one of LUT_1D_SIZE / LUT_3D_SIZE required
    LUT_3D_SIZE <n>
    DOMAIN_MIN <r> <g> <b> optional, defaults to (0, 0, 0)
    DOMAIN_MAX <r> <g> <b> optional, defaults to (1, 1, 1)
    <r> <g> <b>            data rows; count must equal the declared size
    # comment              anywhere; blank lines are ignored

Anything else is a format error. All errors report the 1-based line number.
Parsing is atomic: a file with any error yields no LUT at all (never a
partially filled color table).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Sequence, Tuple

Vec3 = Tuple[float, float, float]


class CubeParseError(ValueError):
    """Format error in a .cube file, carrying the 1-based line number."""

    def __init__(self, line_no: int, message: str, path: str | None = None):
        self.line_no = line_no
        self.path = path
        location = f"{path}:" if path else ""
        super().__init__(f"{location}line {line_no}: {message}")


@dataclass
class CubeLUT:
    """A 1D or 3D LUT with an explicit input domain."""

    size: int
    is_3d: bool
    data: List[Vec3]
    domain_min: Vec3 = (0.0, 0.0, 0.0)
    domain_max: Vec3 = (1.0, 1.0, 1.0)
    title: str = ""

    def __post_init__(self) -> None:
        expected = self.size ** 3 if self.is_3d else self.size
        if len(self.data) != expected:
            raise ValueError(
                f"color table has {len(self.data)} entries, expected {expected}"
            )
        for lo, hi in zip(self.domain_min, self.domain_max):
            if not hi > lo:
                raise ValueError("DOMAIN_MAX must be greater than DOMAIN_MIN")

    # -- editing -----------------------------------------------------------
    def index(self, r: int, g: int, b: int) -> int:
        """Flat table index. 3D tables are stored red-fastest (.cube order)."""
        if self.is_3d:
            return (b * self.size + g) * self.size + r
        if r != g or g != b:
            raise ValueError("1D LUT entries are indexed by a single coordinate")
        return r

    def get(self, r: int, g: int, b: int) -> Vec3:
        return self.data[self.index(r, g, b)]

    def set(self, r: int, g: int, b: int, value: Sequence[float]) -> None:
        if len(value) != 3:
            raise ValueError("LUT entries are RGB triples")
        self.data[self.index(r, g, b)] = (float(value[0]), float(value[1]), float(value[2]))

    # -- constructors ------------------------------------------------------
    @classmethod
    def identity_1d(cls, size: int) -> "CubeLUT":
        data = [(i / (size - 1),) * 3 for i in range(size)]
        return cls(size=size, is_3d=False, data=data, title="identity 1D")

    @classmethod
    def identity_3d(cls, size: int) -> "CubeLUT":
        n = size - 1
        data = [
            (r / n, g / n, b / n)
            for b in range(size)
            for g in range(size)
            for r in range(size)
        ]
        return cls(size=size, is_3d=True, data=data, title="identity 3D")

    # -- serialization -----------------------------------------------------
    def to_cube(self) -> str:
        lines: List[str] = []
        if self.title:
            lines.append(f'TITLE "{self.title}"')
        lines.append(f"LUT_{'3D' if self.is_3d else '1D'}_SIZE {self.size}")
        if self.domain_min != (0.0, 0.0, 0.0):
            lines.append("DOMAIN_MIN " + " ".join(_fmt(v) for v in self.domain_min))
        if self.domain_max != (1.0, 1.0, 1.0):
            lines.append("DOMAIN_MAX " + " ".join(_fmt(v) for v in self.domain_max))
        lines.extend(" ".join(_fmt(v) for v in row) for row in self.data)
        return "\n".join(lines) + "\n"

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(self.to_cube())


def _fmt(value: float) -> str:
    return repr(float(value))


def _floats(tokens: Sequence[str], count: int, line_no: int, path: str | None) -> List[float]:
    if len(tokens) != count:
        raise CubeParseError(
            line_no, f"expected {count} numeric value(s), got {len(tokens)}", path
        )
    try:
        return [float(tok) for tok in tokens]
    except ValueError:
        raise CubeParseError(line_no, f"non-numeric value in {tokens!r}", path) from None


def parse_cube(text: str, path: str | None = None) -> CubeLUT:
    """Parse .cube text. Raises CubeParseError (with line number) on any error.

    The color table is only accepted once the *entire* file validates, so a
    truncated or malformed file never yields a half-loaded LUT.
    """
    title = ""
    size: int | None = None
    is_3d: bool | None = None
    domain_min: Vec3 = (0.0, 0.0, 0.0)
    domain_max: Vec3 = (1.0, 1.0, 1.0)
    data: List[Vec3] = []
    data_started = False

    for line_no, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        tokens = line.split()
        keyword = tokens[0].upper()

        if keyword == "TITLE":
            if data_started:
                raise CubeParseError(line_no, "TITLE must appear before LUT data", path)
            if title:
                raise CubeParseError(line_no, "duplicate TITLE", path)
            match = line.split(None, 1)
            if len(match) < 2 or not (match[1].startswith('"') and match[1].endswith('"')):
                raise CubeParseError(line_no, 'TITLE must be a quoted string', path)
            title = match[1][1:-1]
        elif keyword in ("LUT_1D_SIZE", "LUT_3D_SIZE"):
            if size is not None:
                raise CubeParseError(line_no, "duplicate LUT size declaration", path)
            if data_started:
                raise CubeParseError(line_no, "LUT size must be declared before data", path)
            values = _floats(tokens[1:], 1, line_no, path)
            n = int(values[0])
            if n < 2 or n != values[0]:
                raise CubeParseError(line_no, f"LUT size must be an integer >= 2, got {tokens[1]!r}", path)
            size = n
            is_3d = keyword == "LUT_3D_SIZE"
        elif keyword in ("DOMAIN_MIN", "DOMAIN_MAX"):
            if data_started:
                raise CubeParseError(line_no, f"{keyword} must appear before LUT data", path)
            values = _floats(tokens[1:], 3, line_no, path)
            if keyword == "DOMAIN_MIN":
                domain_min = (values[0], values[1], values[2])
            else:
                domain_max = (values[0], values[1], values[2])
        elif keyword[0].isdigit() or keyword[0] in "+-.":
            if size is None:
                raise CubeParseError(line_no, "LUT data found before LUT size declaration", path)
            data_started = True
            values = _floats(tokens, 3, line_no, path)
            data.append((values[0], values[1], values[2]))
        else:
            raise CubeParseError(
                line_no,
                f"unsupported keyword {tokens[0]!r} (this parser supports TITLE, "
                "LUT_1D_SIZE, LUT_3D_SIZE, DOMAIN_MIN, DOMAIN_MAX and RGB data rows)",
                path,
            )

    if size is None or is_3d is None:
        raise CubeParseError(1, "missing LUT_1D_SIZE / LUT_3D_SIZE declaration", path)
    expected = size ** 3 if is_3d else size
    if len(data) != expected:
        raise CubeParseError(
            len(text.splitlines()) or 1,
            f"color table has {len(data)} entr{'y' if len(data) == 1 else 'ies'}, "
            f"expected {expected} for declared size {size}",
            path,
        )
    try:
        return CubeLUT(
            size=size,
            is_3d=is_3d,
            data=data,
            domain_min=domain_min,
            domain_max=domain_max,
            title=title,
        )
    except ValueError as exc:
        raise CubeParseError(1, str(exc), path) from None


def load_cube(path: str) -> CubeLUT:
    with open(path, "r", encoding="utf-8") as fh:
        return parse_cube(fh.read(), path=path)
