from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .mesh import load_obj, save_obj
from .simplify import SimplifyOptions, simplify_mesh


def _default_paths(input_path: Path) -> tuple[Path, Path, Path]:
    stem = input_path.with_suffix("")
    return (
        Path(f"{stem}.simplified.obj"),
        Path(f"{stem}.collapses.json"),
        Path(f"{stem}.report.json"),
    )


def _write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(document, handle, indent=2, ensure_ascii=False, allow_nan=False)
        handle.write("\n")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Simplify an OBJ mesh with area-weighted quadric error metrics while "
            "locking boundaries, material seams and sharp features."
        )
    )
    parser.add_argument("input", type=Path, help="input OBJ path")
    parser.add_argument(
        "--target-faces",
        type=int,
        required=True,
        help="stop at or below this triangle count",
    )
    parser.add_argument("--output", type=Path, help="simplified OBJ path")
    parser.add_argument("--history", type=Path, help="collapse sequence JSON path")
    parser.add_argument("--report", type=Path, help="summary report JSON path")
    parser.add_argument(
        "--sharp-angle",
        type=float,
        default=60.0,
        help="dihedral angle in degrees treated as a sharp feature (default: 60)",
    )
    parser.add_argument(
        "--no-protect-sharp",
        action="store_true",
        help="do not lock vertices incident to sharp edges",
    )
    parser.add_argument(
        "--max-error",
        type=float,
        default=None,
        help="reject collapses whose quadric error exceeds this value",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="print one line per accepted collapse to stderr",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    input_path: Path = args.input
    default_output, default_history, default_report = _default_paths(input_path)
    output_path = args.output or default_output
    history_path = args.history or default_history
    report_path = args.report or default_report

    try:
        mesh = load_obj(input_path)
        options = SimplifyOptions(
            target_faces=args.target_faces,
            protect_sharp=not args.no_protect_sharp,
            sharp_angle_degrees=args.sharp_angle,
            max_error=args.max_error,
        )
        result = simplify_mesh(mesh, options)
        save_obj(
            output_path,
            result.vertices,
            result.faces,
            result.face_materials,
            mtllib=mesh.mtllib,
            object_name=mesh.object_name,
        )
        reloaded = load_obj(output_path)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    counts_match = (
        reloaded.vertex_count == result.final_vertex_count
        and reloaded.face_count == result.final_face_count
    )
    if not counts_match:
        print(
            "error: OBJ round-trip count mismatch: "
            f"exported {result.final_vertex_count} vertices/"
            f"{result.final_face_count} faces, reloaded "
            f"{reloaded.vertex_count} vertices/{reloaded.face_count} faces",
            file=sys.stderr,
        )
        return 2

    roundtrip = {
        "path": str(output_path),
        "exported_vertices": result.final_vertex_count,
        "exported_faces": result.final_face_count,
        "reloaded_vertices": reloaded.vertex_count,
        "reloaded_faces": reloaded.face_count,
        "counts_match": counts_match,
    }
    report = result.report()
    report["obj_roundtrip"] = roundtrip
    history = {
        "schema": "qem-collapse-sequence/v1",
        "source_obj": str(input_path),
        "output_obj": str(output_path),
        "options": {
            "target_faces": options.target_faces,
            "protect_boundary": options.protect_boundary,
            "protect_material": options.protect_material,
            "protect_sharp": options.protect_sharp,
            "sharp_angle_degrees": options.sharp_angle_degrees,
            "min_normal_dot": options.min_normal_dot,
            "min_face_area": options.min_face_area,
            "max_error": options.max_error,
        },
        "summary": {
            "initial_vertices": result.initial_vertex_count,
            "initial_faces": result.initial_face_count,
            "final_vertices": result.final_vertex_count,
            "final_faces": result.final_face_count,
            "stop_reason": result.stop_reason,
            "stop_detail": result.stop_detail,
        },
        "collapses": result.rounds,
        "rejected_attempts": dict(sorted(result.rejected.items())),
    }

    try:
        _write_json(history_path, history)
        _write_json(report_path, report)
    except OSError as exc:
        print(f"error: could not write JSON output: {exc}", file=sys.stderr)
        return 1

    if args.verbose:
        for item in result.rounds:
            print(
                f"round={item['round']:4d} "
                f"faces={item['faces_after']:5d} "
                f"error={item['quadric_error']:.10g} "
                f"cumulative={item['cumulative_error']:.10g}",
                file=sys.stderr,
            )
    print(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False))
    return 0

