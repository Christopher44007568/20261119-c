"""Command line interface for the L-system generator.

Subcommands::

    check     parse a grammar and show symbol-position errors / warnings
    estimate  report projected expansion size without building anything
    generate  expand, sweep tubes, validate and export all artifacts
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from .errors import LSystemError, LSystemSyntaxError
from .expander import expand, estimate_expansion
from .export import (
    write_derivation_dot,
    write_derivation_json,
    write_manifest,
    write_svg,
)
from .mesh import build_mesh, write_obj
from .parser import parse_grammar
from .turtle import run_turtle
from .validate import validate_result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lsys",
        description="Deterministic L-system branching tube generator",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check", help="parse grammar and report errors")
    check.add_argument("grammar")

    estimate = sub.add_parser(
        "estimate", help="estimate expansion size per iteration"
    )
    estimate.add_argument("grammar")
    estimate.add_argument("iterations", type=int)
    estimate.add_argument("--max-symbols", type=int, default=5_000_000)

    generate = sub.add_parser("generate", help="full generation pipeline")
    generate.add_argument("grammar")
    generate.add_argument("iterations", type=int)
    generate.add_argument("--outdir", default="out")
    generate.add_argument("--segments", type=int, default=None,
                          help="override radial cross-section segments")
    generate.add_argument("--max-iterations", type=int, default=12)
    generate.add_argument("--max-symbols", type=int, default=5_000_000)
    generate.add_argument("--max-depth", type=int, default=256)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        with open(args.grammar, encoding="utf-8") as handle:
            source = handle.read()
        grammar = parse_grammar(source)
    except FileNotFoundError:
        print(f"error: grammar file not found: {args.grammar}",
              file=sys.stderr)
        return 2
    except LSystemSyntaxError as error:
        print(str(error), file=sys.stderr)
        return 1

    if args.command == "check":
        print(f"grammar OK: {len(grammar.rules)} rules, "
              f"{len(grammar.axiom)} axiom symbols")
        for warning in grammar.warnings:
            print("warning:", warning)
        return 0

    if args.command == "estimate":
        report = estimate_expansion(grammar, args.iterations)
        print(json.dumps(report, indent=2))
        if report["total_symbols"] > args.max_symbols:
            print(
                f"REJECTED: {report['total_symbols']:,} symbols exceed "
                f"limit {args.max_symbols:,}",
                file=sys.stderr,
            )
            return 3
        return 0

    return _run_generate(args, grammar)


def _run_generate(args, grammar) -> int:
    try:
        estimate = estimate_expansion(grammar, args.iterations)
        print("expansion estimate:", json.dumps({
            key: estimate[key]
            for key in (
                "total_symbols", "forward_symbols", "branch_pushes",
                "max_bracket_depth",
            )
        }))
        expansion = expand(
            grammar,
            args.iterations,
            max_iterations=args.max_iterations,
            max_symbols=args.max_symbols,
            max_depth=args.max_depth,
        )
        result = run_turtle(grammar, expansion.tokens)
        radial = (
            args.segments
            if args.segments is not None
            else int(grammar.params["segments"])
        )
        mesh = build_mesh(result, radial_segments=radial)
        validation = validate_result(result, mesh, radial)
    except LSystemError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    os.makedirs(args.outdir, exist_ok=True)
    base = os.path.splitext(os.path.basename(args.grammar))[0]
    obj_path = os.path.join(args.outdir, f"{base}.obj")
    tree_json = os.path.join(args.outdir, f"{base}.derivation.json")
    tree_dot = os.path.join(args.outdir, f"{base}.derivation.dot")
    manifest = os.path.join(args.outdir, f"{base}.manifest.json")
    svg_xy = os.path.join(args.outdir, f"{base}.xy.svg")
    svg_yz = os.path.join(args.outdir, f"{base}.yz.svg")

    write_obj(mesh, obj_path)
    write_derivation_json(expansion, tree_json)
    write_derivation_dot(expansion, tree_dot)
    write_manifest(
        manifest, args.grammar, args.iterations, estimate,
        result, mesh, validation,
    )
    write_svg(result, svg_xy, f"{base} n={args.iterations}", "xy")
    write_svg(result, svg_yz, f"{base} n={args.iterations}", "yz")

    print(f"branches={len(result.branches)} "
          f"segments={result.forward_count} "
          f"vertices={len(mesh.vertices)} faces={len(mesh.faces)}")
    print(f"validation ok={validation['ok']}")
    _print_validation_summary(validation)
    print("artifacts:")
    for path in (obj_path, tree_json, tree_dot, manifest, svg_xy, svg_yz):
        print(" ", path)
    return 0 if validation["ok"] else 4


def _print_validation_summary(report: dict) -> None:
    water = report["watertight"]
    print(
        "  watertight:", water["ok"],
        f"boundary_edges={water['boundary_edge_count']}",
        f"non_manifold={water['non_manifold_edge_count']}",
    )
    frame = report["frame"]
    print(
        "  frame:", frame["ok"],
        f"max_error={frame['max_orthonormality_error']:.2e}",
    )
    twist = report["twist"]
    print(
        "  twist: max_roll=",
        f"{twist['max_roll_degrees']:.2f} deg",
        f"max_ring_rotation={twist['max_ring_to_ring_rotation_degrees']:.2f}",
    )
    turns = report["turns"]
    print(
        "  sharp turns >=", turns["threshold_degrees"],
        "deg:", turns["sharp_turn_count"],
    )
    junctions = report["junctions"]
    print(
        "  junctions: welded=", junctions["welded_junction_count"],
        "max_crack_gap=", f"{junctions['max_crack_gap']:.2e}",
        "radius_mismatches=", junctions["radius_mismatch_count"],
    )


if __name__ == "__main__":
    raise SystemExit(main())
