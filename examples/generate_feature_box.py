#!/usr/bin/env python3
"""Generate a welded closed box with sharp edges and material seams."""

from __future__ import annotations

import argparse
from pathlib import Path


Point = tuple[float, float, float]


def _surface(
    cells: int,
    origin: Point,
    axis_u: Point,
    axis_v: Point,
) -> dict[tuple[int, int], Point]:
    points: dict[tuple[int, int], Point] = {}
    for row in range(cells + 1):
        v = -1.0 + 2.0 * row / cells
        for column in range(cells + 1):
            u = -1.0 + 2.0 * column / cells
            points[(row, column)] = (
                origin[0] + axis_u[0] * u + axis_v[0] * v,
                origin[1] + axis_u[1] * u + axis_v[1] * v,
                origin[2] + axis_u[2] * u + axis_v[2] * v,
            )
    return points


def generate(cells: int) -> tuple[list[Point], list[tuple[int, int, int, str]]]:
    surfaces = [
        (
            (1.0, 0.0, 0.0),
            (0.0, 1.0, 0.0),
            (0.0, 0.0, 1.0),
            "BodyGray",
        ),
        (
            (-1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0),
            (0.0, 1.0, 0.0),
            "BodyGray",
        ),
        (
            (0.0, 1.0, 0.0),
            (0.0, 0.0, 1.0),
            (1.0, 0.0, 0.0),
            "BodyGray",
        ),
        (
            (0.0, -1.0, 0.0),
            (1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0),
            "BodyGray",
        ),
        (
            (0.0, 0.0, 1.0),
            (1.0, 0.0, 0.0),
            (0.0, 1.0, 0.0),
            "TopRed",
        ),
        (
            (0.0, 0.0, -1.0),
            (0.0, 1.0, 0.0),
            (1.0, 0.0, 0.0),
            "BodyGray",
        ),
        (
            (1.0, 0.0, 0.0),
            (0.0, 1.0, 0.0),
            (0.0, 0.0, 1.0),
            "PanelBlue",
        ),
    ]
    # The final entry replaces the first +X surface with a distinct material.
    surfaces.pop(0)

    vertex_lookup: dict[tuple[float, float, float], int] = {}
    vertices: list[Point] = []

    def vertex_id(point: Point) -> int:
        key = tuple(round(value, 12) for value in point)
        if key not in vertex_lookup:
            vertex_lookup[key] = len(vertices)
            vertices.append(key)
        return vertex_lookup[key]

    faces: list[tuple[int, int, int, str]] = []
    for origin, axis_u, axis_v, material in surfaces:
        grid = _surface(cells, origin, axis_u, axis_v)
        if material == "TopRed":
            for key, (x, y, z) in grid.items():
                grid[key] = (x, y, z + 0.12 * (1.0 - x * x) * (1.0 - y * y))
        for row in range(cells):
            for column in range(cells):
                a = vertex_id(grid[(row, column)])
                b = vertex_id(grid[(row, column + 1)])
                c = vertex_id(grid[(row + 1, column + 1)])
                d = vertex_id(grid[(row + 1, column)])
                faces.append((a, b, c, material))
                faces.append((a, c, d, material))
    return vertices, faces


def write_obj(
    directory: Path, cells: int
) -> tuple[Path, Path, int, int]:
    vertices, faces = generate(cells)
    obj_path = directory / "feature_box.obj"
    mtl_path = directory / "feature_box.mtl"
    directory.mkdir(parents=True, exist_ok=True)

    with obj_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("# Closed box: 90-degree sharp edges and material seams\n")
        handle.write("mtllib feature_box.mtl\n")
        handle.write("o FeatureBox\n")
        for x, y, z in vertices:
            handle.write(f"v {x:.8g} {y:.8g} {z:.8g}\n")
        previous_material = None
        for a, b, c, material in faces:
            if material != previous_material:
                handle.write(f"usemtl {material}\n")
                previous_material = material
            handle.write(f"f {a + 1} {b + 1} {c + 1}\n")

    with mtl_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("newmtl BodyGray\n")
        handle.write("Kd 0.55 0.58 0.62\n")
        handle.write("newmtl TopRed\n")
        handle.write("Kd 0.72 0.18 0.12\n")
        handle.write("newmtl PanelBlue\n")
        handle.write("Kd 0.12 0.30 0.65\n")
    return obj_path, mtl_path, len(vertices), len(faces)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cells",
        type=int,
        default=6,
        help="subdivisions per box side (default: 6)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent,
    )
    args = parser.parse_args()
    if args.cells < 2:
        parser.error("--cells must be at least 2")
    obj_path, mtl_path, vertices, faces = write_obj(
        args.output_dir.resolve(), args.cells
    )
    print(
        f"wrote {obj_path} ({vertices} vertices, {faces} faces) "
        f"and {mtl_path}"
    )


if __name__ == "__main__":
    main()
