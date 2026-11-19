"""Multi-camera triangulation viewer — CLI entry point.

Usage:
  python main.py demo [--sigma 1.0] [--seed 0] [--snapshot out/demo.png]
                      [--exclude track:camera ...]
  python main.py study [--trials 50] [--snapshot out/study.png]
"""
from __future__ import annotations

import argparse
import os

import numpy as np

from multiview.noise_study import plot_study, run_study, study_points
from multiview.scene import make_scene
from multiview.triangulate import ellipsoid, evaluate
from multiview.viewer import STATUS_STYLE, run_viewer


def report(scene, results):
    for res in results:
        style = STATUS_STYLE[res.status]
        print(f"[{res.track.name}] status={style['label']}  "
              f"max_angle={res.max_angle_deg:.2f} deg")
        if res.point is not None:
            print(f"  point = {np.round(res.point, 4)}")
            if res.track.truth is not None:
                err = np.linalg.norm(res.point - res.track.truth)
                print(f"  truth = {np.round(res.track.truth, 4)}  "
                      f"err={err:.4f} m")
            radii, _ = ellipsoid(res.covariance, scene.pixel_sigma)
            print(f"  95% ellipsoid radii = {np.round(radii, 4)} m")
        for o in res.track.observations:
            cam = scene.cameras[o.camera].name
            flags = ",".join(f.value for f in o.flags) or "-"
            r = f"{o.residual:6.2f}px" if np.isfinite(o.residual) else "n/a"
            print(f"    {cam}: residual={r}  flags={flags}")


def cmd_demo(args):
    scene = make_scene(seed=args.seed, pixel_sigma=args.sigma)
    for spec in args.exclude:
        name, cam = spec.split(":")
        track = next(t for t in scene.tracks if t.name == name)
        obs = next(o for o in track.observations
                   if scene.cameras[o.camera].name == cam)
        obs.excluded = True
    results = [evaluate(t, scene.cameras, pixel_sigma=scene.pixel_sigma)
               for t in scene.tracks]
    report(scene, results)
    if args.snapshot:
        os.makedirs(os.path.dirname(args.snapshot) or ".", exist_ok=True)
    run_viewer(scene, snapshot=args.snapshot)
    if args.snapshot:
        print(f"snapshot saved to {args.snapshot}")


def cmd_study(args):
    scene = make_scene(seed=args.seed, pixel_sigma=1.0)
    points = study_points()
    sigmas = [0.1, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0]
    result = run_study(scene.cameras, points, sigmas, trials=args.trials)
    print(f"{'sigma':>6} {'median_err':>11} {'p95_err':>9} "
          f"{'ellipsoid':>10} {'ok_rate':>8}")
    for r in result["rows"]:
        print(f"{r['sigma']:6.2f} {r['median_err']:11.4f} "
              f"{r['p95_err']:9.4f} {r['ellipsoid_max']:10.4f} "
              f"{r['ok_rate']:8.2f}")
    if args.snapshot:
        os.makedirs(os.path.dirname(args.snapshot) or ".", exist_ok=True)
        plot_study(result, args.snapshot)
        print(f"study plot saved to {args.snapshot}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("demo", help="synthetic scene + viewer")
    d.add_argument("--sigma", type=float, default=1.0,
                   help="pixel noise std [px]")
    d.add_argument("--seed", type=int, default=0)
    d.add_argument("--snapshot", default=None, help="save figure to PNG")
    d.add_argument("--exclude", nargs="*", default=[],
                   help="pre-exclude observations, e.g. p0:cam2")
    d.set_defaults(fn=cmd_demo)

    s = sub.add_parser("study", help="noise sensitivity sweep")
    s.add_argument("--trials", type=int, default=50)
    s.add_argument("--seed", type=int, default=0)
    s.add_argument("--snapshot", default="out/study.png")
    s.set_defaults(fn=cmd_study)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
