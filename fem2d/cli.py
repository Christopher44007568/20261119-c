"""Command-line interface for the 2D triangular-mesh elasticity solver.

Examples
--------
python -m fem2d.cli --case tension --nx 20 --ny 8 --E 210e9 --nu 0.3
python -m fem2d.cli --case cantilever --nx 32 --ny 8 --load 1e4
python -m fem2d.cli --case tension --no-bc   # triggers singularity report
"""

from __future__ import annotations

import argparse
import sys

import numpy as np

from .cases import cantilever_case, tension_case
from .core import (
    Material,
    SingularSystemError,
    assemble_stiffness,
    element_strains,
    reaction_forces,
    solve,
)
from .mesh import make_rect_mesh
from .plot import plot_results


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="fem2d",
        description="2D linear elasticity (plane-stress CST triangles) solver",
    )
    p.add_argument("--case", choices=["tension", "cantilever"], default="tension")
    p.add_argument("--L", type=float, default=1.0, help="plate length [m]")
    p.add_argument("--H", type=float, default=0.2, help="plate height [m]")
    p.add_argument("--t", type=float, default=0.01, help="thickness [m]")
    p.add_argument("--E", type=float, default=210e9, help="Young's modulus [Pa]")
    p.add_argument("--nu", type=float, default=0.3, help="Poisson's ratio [-]")
    p.add_argument("--nx", type=int, default=20, help="elements along x")
    p.add_argument("--ny", type=int, default=8, help="elements along y")
    p.add_argument(
        "--load",
        type=float,
        default=None,
        help="tension: traction sigma [Pa]; cantilever: end force P [N]",
    )
    p.add_argument(
        "--no-bc",
        action="store_true",
        help="apply no Dirichlet BCs (demonstrates singularity reporting)",
    )
    p.add_argument("--out", default="results/solution.png", help="figure path")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    mat = Material(E=args.E, nu=args.nu, thickness=args.t)
    nodes, elems = make_rect_mesh(args.L, args.H, args.nx, args.ny)
    print(f"mesh: {nodes.shape[0]} nodes, {elems.shape[0]} triangles "
          f"({args.nx} x {args.ny} grid)")
    print(f"material: E={mat.E:.4g} Pa, nu={mat.nu}, t={mat.thickness} m "
          f"(plane stress, linear small-strain)")

    if args.case == "tension":
        sigma = args.load if args.load is not None else 100e6
        fixed, presc, F, desc = tension_case(nodes, mat.thickness, sigma)
    else:
        P = args.load if args.load is not None else 1e4
        fixed, presc, F, desc = cantilever_case(nodes, mat.thickness, P)
    if args.no_bc:
        fixed = np.array([], dtype=int)
        presc = np.array([])
        desc += " [NO Dirichlet BCs]"
    print(f"case: {desc}")

    K = assemble_stiffness(nodes, elems, mat)
    try:
        u = solve(nodes, K, F, fixed, presc)
    except SingularSystemError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    R = reaction_forces(K, u, F)
    strains = element_strains(nodes, elems, u)
    print(f"max |u| = {np.hypot(u[0::2], u[1::2]).max():.6e} m")
    print(f"reaction sum: Fx={R[0::2].sum():.6e} N, Fy={R[1::2].sum():.6e} N "
          f"(applied: Fx={F[0::2].sum():.6e} N, Fy={F[1::2].sum():.6e} N)")
    plot_results(nodes, elems, u, strains, R, fixed, args.out,
                 title=f"{args.case}  E={mat.E:.3g} Pa, nu={mat.nu}, "
                       f"mesh {args.nx}x{args.ny}")
    print(f"figure written to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
