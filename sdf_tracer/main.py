"""Command-line entry point for the SDF sphere tracer."""
import argparse
import math
import os

from .sdf import Scene
from .camera import Camera
from .render import render
from .png import write_png
from . import debug, tracer


def _vec3(text):
    parts = [float(x) for x in text.split(",")]
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("expected three comma-separated "
                                         "numbers, got %r" % text)
    return tuple(parts)


def _pixels(text):
    out = set()
    for item in text.split(";"):
        item = item.strip()
        if not item:
            continue
        x, y = item.split(",")
        out.add((int(x), int(y)))
    return out


def build_parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--width", type=int, default=480)
    p.add_argument("--height", type=int, default=320)
    p.add_argument("--out", default="artifacts/render.png")
    p.add_argument("--debug-out", default="artifacts/debug_rays.txt")
    p.add_argument("--eye", type=_vec3, default=(0.0, 0.0, 4.2))
    p.add_argument("--target", type=_vec3, default=(0.0, 0.0, 0.0))
    p.add_argument("--fov", type=float, default=45.0)
    p.add_argument("--euler", type=_vec3,
                   help="local-frame rotation in degrees (ax,ay,az)",
                   default=(25.0, 15.0, 35.0))
    p.add_argument("--blend", type=float, default=0.35,
                   help="smooth-union connection radius")
    p.add_argument("--max-steps", type=int, default=64)
    p.add_argument("--far", type=float, default=20.0)
    p.add_argument("--debug-pixels", type=_pixels,
                   help="semicolon list of x,y pixels to trace in detail",
                   default=((240, 160),))
    p.add_argument("--inside", action="store_true",
                   help="place the camera inside the object and look out")
    return p


def run(argv=None):
    args = build_parser().parse_args(argv)
    if args.inside:
        eye = (0.05, 0.05, 0.05)
        target = (1.0, 1.0, 1.0)
    else:
        eye, target = args.eye, args.target

    euler_rad = tuple(math.radians(a) for a in args.euler)
    scene = Scene(center=(0.0, 0.0, 0.0), euler=euler_rad,
                  blend_radius=args.blend)
    camera = Camera(eye, target, fov_y_deg=args.fov)

    rows, stats, reports = render(scene, camera, args.width, args.height,
                                  max_steps=args.max_steps, far=args.far,
                                  debug_pixels=args.debug_pixels)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    write_png(args.out, args.width, args.height, rows)

    debug.write_reports(args.debug_out, reports)
    _print_summary(args, stats, reports)
    return stats


def _print_summary(args, stats, reports):
    total = sum(stats.values())
    print("rendered %dx%d -> %s" % (args.width, args.height, args.out))
    print("pixels: total=%d  hit=%d  over_steps=%d  far=%d  degenerate=%d"
          % (total, stats[tracer.HIT_SURFACE], stats[tracer.OVER_STEPS],
             stats[tracer.FAR_PLANE], stats[tracer.DEGENERATE]))
    print("over-step share: %.3f%% (rendered as magenta, not background)"
          % (100.0 * stats[tracer.OVER_STEPS] / total))
    for _pixel, _ray, result, validation in reports:
        print("[debug pixel %s] reason=%s steps=%d min_dist=%.3e "
              "marched=%s analytic=%s within_bound=%s"
              % (_pixel, result["reason"], result["steps"],
                 result["min_distance"],
                 debug._fmt(validation["marched_t"]),
                 debug._fmt(validation["analytic_t"]),
                 validation["within_bound"]))


if __name__ == "__main__":
    run()
