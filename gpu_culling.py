from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
import time

from frustum import CapacityError, Camera, Frustum
from gl_api import (
    GL_RENDERER,
    GL_SHADING_LANGUAGE_VERSION,
    GL_VENDOR,
    GL_VERSION,
    EglContext,
)
from gpu_culler import GpuFrustumCuller, RunResult
from scenarios import Scenario, build_scenarios


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="GPU sphere-frustum culling with indirect drawing",
    )
    parser.add_argument("--instances", type=int, default=262_144)
    parser.add_argument("--near-per-face", type=int, default=1024)
    parser.add_argument("--seed", type=int, default=20261119)
    parser.add_argument(
        "--visible-capacity",
        type=int,
        default=None,
        help="visible-index slots; defaults to --instances",
    )
    parser.add_argument(
        "--scenario",
        action="append",
        choices=("invisible", "all-visible", "near-planes", "mixed"),
        help="run only the selected scenario; may be repeated",
    )
    parser.add_argument("--json", type=Path)
    return parser.parse_args()


def _scenario_row(result: RunResult, sphere_count: int) -> str:
    return (
        f"{result.scenario_name:<14} "
        f"{sphere_count:>9} "
        f"{len(result.expected_ids):>9} "
        f"{len(result.gpu_ids):>9} "
        f"{result.indirect_count:>9} "
        f"{'yes' if result.draw_any_samples else 'no':>6} "
        f"{'match' if result.ids_match else 'MISMATCH':>10} "
        f"{'yes' if result.overflow else 'no':>8} "
        f"{result.gl_error:>8} "
        f"{'PASS' if result.passed else 'FAIL':>5}"
    )


def _run_selected(
    culler: GpuFrustumCuller,
    scenarios: list[Scenario],
    selected: set[str] | None,
    frustum: Frustum,
) -> list[tuple[Scenario, RunResult, float]]:
    results = []
    for scenario in scenarios:
        if selected is not None and scenario.name not in selected:
            continue
        started = time.perf_counter()
        result = culler.run(scenario.name, scenario.spheres, frustum)
        elapsed = time.perf_counter() - started
        results.append((scenario, result, elapsed))
    return results


def main() -> int:
    args = _parse_arguments()
    if args.instances <= 0:
        print("--instances must be positive", file=sys.stderr)
        return 2
    visible_capacity = (
        args.instances if args.visible_capacity is None else args.visible_capacity
    )
    if visible_capacity < args.instances:
        print(
            "visible-index capacity must be at least the instance count",
            file=sys.stderr,
        )
        return 2

    camera = Camera(
        eye=(0.0, 3.0, 8.0),
        target=(0.0, 0.0, 0.0),
        up=(0.0, 1.0, 0.0),
        fov_y=math.radians(60.0),
        aspect=1.0,
        near=0.5,
        far=30.0,
    )
    frustum = Frustum.from_camera(camera)
    scenarios = build_scenarios(
        frustum,
        count=args.instances,
        near_per_face=args.near_per_face,
        seed=args.seed,
    )
    selected = set(args.scenario) if args.scenario else None
    try:
        with EglContext():
            culler = GpuFrustumCuller(
                instance_capacity=args.instances,
                visible_capacity=visible_capacity,
            )
            try:
                print(f"Vendor:   {culler.gl.string(GL_VENDOR)}")
                print(f"Renderer: {culler.gl.string(GL_RENDERER)}")
                print(f"OpenGL:   {culler.gl.string(GL_VERSION)}")
                print(f"GLSL:     {culler.gl.string(GL_SHADING_LANGUAGE_VERSION)}")
                results = _run_selected(culler, scenarios, selected, frustum)
                report = _build_report(args, culler, results)
            finally:
                culler.close()
    except (CapacityError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    if not results:
        print("no scenario selected", file=sys.stderr)
        return 2

    print()
    print(
        "Capacity: "
        f"instances {args.instances}/{culler.instance_capacity}, "
        f"visible-index slots {culler.visible_capacity}, "
        f"indirect command {culler.indirect_bytes} bytes [OK]"
    )
    print()
    print(
        f"{'scenario':<14} {'instances':>9} {'CPU vis':>9} {'GPU vis':>9} "
        f"{'indirect':>9} {'draw':>6} {'IDs':>10} {'overflow':>8} "
        f"{'GL err':>8} {'result':>5}"
    )
    for scenario, result, _ in results:
        print(_scenario_row(result, len(scenario.spheres)))

    print()
    print("Synchronization order used by every run:")
    for index, step in enumerate(results[0][1].sync_trace, start=1):
        print(f"  {index}. {step}")

    all_passed = all(result.passed for _, result, _ in results)
    invisible = next(
        (result for scenario, result, _ in results if scenario.name == "invisible"),
        None,
    )
    if invisible is not None:
        zero_visible_ok = (
            invisible.indirect_count == 0
            and invisible.visible_count == 0
            and invisible.gl_error == 0
        )
        print(
            "Zero-visible check: "
            f"{'PASS' if zero_visible_ok else 'FAIL'} "
            "(indirect count is zero; no GL error)"
        )
        all_passed = all_passed and zero_visible_ok

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"Report: {args.json}")
    return 0 if all_passed else 1


def _build_report(
    args: argparse.Namespace,
    culler: GpuFrustumCuller,
    results: list[tuple[Scenario, RunResult, float]],
) -> dict:
    return {
        "instances": args.instances,
        "instance_capacity": culler.instance_capacity,
        "visible_capacity": culler.visible_capacity,
        "indirect_bytes": culler.indirect_bytes,
        "seed": args.seed,
        "near_per_face": args.near_per_face,
        "scenarios": [
            {
                "name": scenario.name,
                "description": scenario.description,
                "instance_count": len(scenario.spheres),
                "cpu_visible_count": len(result.expected_ids),
                "gpu_visible_count": len(result.gpu_ids),
                "indirect_count": result.indirect_count,
                "ids_match": result.ids_match,
                "draw_any_samples": result.draw_any_samples,
                "overflow": result.overflow,
                "gl_error": result.gl_error,
                "elapsed_seconds": elapsed,
                "passed": result.passed,
            }
            for scenario, result, elapsed in results
        ],
        "sync_order": list(results[0][1].sync_trace) if results else [],
    }


if __name__ == "__main__":
    raise SystemExit(main())
