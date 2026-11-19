"""Command-line entry: run all four surfaces and write artifacts."""

from __future__ import annotations

import argparse
import os

from . import report, visualize
from .pipeline import run_surface

SURFACES = ("cylinder", "sphere", "saddle", "plane")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="outputs",
                        help="output directory for figures and CSVs")
    parser.add_argument("--surfaces", nargs="*", default=list(SURFACES),
                        choices=SURFACES)
    args = parser.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    all_summary = {}
    for name in args.surfaces:
        print(f"[hatching] {name}")
        art = run_surface(name)
        mesh = art["mesh"]
        lines = art["lines"]
        report.write_length_csv(
            os.path.join(args.out, f"{name}_line_lengths.csv"), lines)
        report.write_breaks_csv(
            os.path.join(args.out, f"{name}_breaks.csv"), art["breaks"])
        report.write_summary_json(
            os.path.join(args.out, f"{name}_summary.json"), art["summary"])
        visualize.plot_hatching_views(
            mesh, lines, os.path.join(args.out, f"{name}_hatching_views.png"))
        visualize.plot_direction_field(
            mesh, art["curv"], art["field_directions"], art["field_source"],
            os.path.join(args.out, f"{name}_field.png"))
        visualize.plot_tangent_planes(
            mesh, art["curv"], art["field_directions"],
            os.path.join(args.out, f"{name}_tangent_planes.png"))
        visualize.plot_breaks(
            mesh, lines, art["breaks"],
            os.path.join(args.out, f"{name}_breaks.png"))
        visualize.plot_length_histogram(
            name, lines,
            os.path.join(args.out, f"{name}_length_histogram.png"))
        all_summary[name] = art["summary"]
        print(f"  -> wrote 7 artifacts for {name}")
    report.write_summary_json(
        os.path.join(args.out, "summary.json"), all_summary)
    print(f"[hatching] done; summary at {os.path.join(args.out, 'summary.json')}")


if __name__ == "__main__":
    main()
