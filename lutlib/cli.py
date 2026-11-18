"""Command line interface.

    python -m lutlib info  file.cube
        Validate a .cube file and print its declared subset metadata,
        including DOMAIN_MIN / DOMAIN_MAX.

    python -m lutlib apply file.cube input.ppm output.ppm [--tonemap aces]
        Tone map and grade a PPM (P3/P6) scene through the LUT.
"""

from __future__ import annotations

import argparse
import sys
from typing import List, Tuple

from .cube import CubeLUT, CubeParseError, load_cube
from .grading import GradingPipeline

Vec3 = Tuple[float, float, float]


def _cmd_info(args: argparse.Namespace) -> int:
    try:
        lut = load_cube(args.cube)
    except CubeParseError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    kind = "3D" if lut.is_3d else "1D"
    print(f"file:        {args.cube}")
    if lut.title:
        print(f"title:       {lut.title}")
    print(f"type:        LUT_{kind}_SIZE {lut.size} ({len(lut.data)} entries)")
    print(f"DOMAIN_MIN:  {' '.join(f'{v:g}' for v in lut.domain_min)}")
    print(f"DOMAIN_MAX:  {' '.join(f'{v:g}' for v in lut.domain_max)}")
    return 0


def read_ppm(path: str) -> Tuple[int, int, List[Vec3]]:
    with open(path, "rb") as fh:
        raw = fh.read()
    tokens: List[bytes] = []
    i = 0
    while i < len(raw) and len(tokens) < 4:
        if raw[i:i+1].isspace():
            i += 1
        elif raw[i:i+1] == b"#":
            while i < len(raw) and raw[i:i+1] != b"\n":
                i += 1
        else:
            j = i
            while j < len(raw) and not raw[j:j+1].isspace():
                j += 1
            tokens.append(raw[i:j])
            i = j
    if len(tokens) < 4:
        raise ValueError(f"{path}: truncated PPM header")
    magic = tokens[0].decode()
    width, height, maxval = int(tokens[1]), int(tokens[2]), int(tokens[3])
    while i < len(raw) and raw[i:i+1].isspace():
        i += 1
    pixels: List[Vec3] = []
    if magic == "P6":
        body = raw[i:]
        expected = width * height * 3
        if len(body) < expected:
            raise ValueError(f"{path}: pixel data truncated")
        for k in range(0, expected, 3):
            pixels.append((body[k] / maxval, body[k+1] / maxval, body[k+2] / maxval))
    elif magic == "P3":
        values = raw[i:].split()
        if len(values) < width * height * 3:
            raise ValueError(f"{path}: pixel data truncated")
        for k in range(0, width * height * 3, 3):
            pixels.append(tuple(int(values[k+c]) / maxval for c in range(3)))  # type: ignore[arg-type]
    else:
        raise ValueError(f"{path}: unsupported magic {magic!r} (want P3 or P6)")
    return width, height, pixels


def write_ppm(path: str, width: int, height: int, pixels: List[Vec3]) -> None:
    body = bytearray()
    for r, g, b in pixels:
        body += bytes(
            max(0, min(255, round(c * 255))) for c in (r, g, b)
        )
    with open(path, "wb") as fh:
        fh.write(f"P6\n{width} {height}\n255\n".encode())
        fh.write(bytes(body))


def _cmd_apply(args: argparse.Namespace) -> int:
    try:
        lut = load_cube(args.cube)
    except CubeParseError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    width, height, pixels = read_ppm(args.input)
    pipeline = GradingPipeline(
        lut=lut, operator=args.tonemap, lut_enabled=not args.no_lut, method=args.method
    )
    graded = pipeline.grade_scene(pixels)
    write_ppm(args.output, width, height, graded)
    state = "on" if not args.no_lut else "off"
    print(f"graded {width}x{height} scene (tonemap={args.tonemap}, lut={state}) -> {args.output}")
    return 0


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lutlib", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_info = sub.add_parser("info", help="validate a .cube file and show its metadata")
    p_info.add_argument("cube")
    p_info.set_defaults(func=_cmd_info)

    p_apply = sub.add_parser("apply", help="tone map and grade a PPM scene through a LUT")
    p_apply.add_argument("cube")
    p_apply.add_argument("input")
    p_apply.add_argument("output")
    p_apply.add_argument("--tonemap", default="aces", choices=["aces", "reinhard", "none"])
    p_apply.add_argument("--method", default="tetrahedral", choices=["tetrahedral", "trilinear"])
    p_apply.add_argument("--no-lut", action="store_true", help="bypass the LUT stage")
    p_apply.set_defaults(func=_cmd_apply)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
