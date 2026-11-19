"""Verification suite for the fem2d solver.

Checks
------
1. Uniform tension specimen against the analytic 1D solution
   (displacement, strain, reaction force balance).
2. Singularity reporting when rigid-body modes are unconstrained
   (the solver must refuse, never silently add fixations).
3. Mesh-refinement convergence of a cantilever against Timoshenko
   beam theory (including shear deformation).

Run:  python3 verify.py
"""

from __future__ import annotations

import numpy as np

from fem2d.cases import cantilever_case, tension_case
from fem2d.core import (
    Material,
    SingularSystemError,
    assemble_stiffness,
    element_strains,
    reaction_forces,
    solve,
)
from fem2d.mesh import boundary_nodes, make_rect_mesh

PASS, FAIL = "PASS", "FAIL"
results = []


def report(name, ok, detail=""):
    results.append(ok)
    print(f"  [{PASS if ok else FAIL}] {name}" + (f"  -- {detail}" if detail else ""))


def check_tension():
    print("1. Uniform tension specimen vs analytic solution")
    L, H, t = 1.0, 0.2, 0.01
    E, nu = 210e9, 0.3
    sigma = 100e6
    mat = Material(E, nu, t)
    nodes, elems = make_rect_mesh(L, H, 40, 16)
    fixed, presc, F, _ = tension_case(nodes, t, sigma)
    K = assemble_stiffness(nodes, elems, mat)
    u = solve(nodes, K, F, fixed, presc)
    R = reaction_forces(K, u, F)
    strains = element_strains(nodes, elems, u)

    ux_tip = u[0::2][boundary_nodes(nodes, "right")]
    ux_exact = sigma * L / E
    err_ux = abs(ux_tip.mean() - ux_exact) / ux_exact
    report("tip displacement ux(L) = sigma*L/E", err_ux < 5e-3,
           f"FEM {ux_tip.mean():.6e} m, exact {ux_exact:.6e} m, rel.err {err_ux:.2e}")

    ex = strains[:, 0].mean()
    ey = strains[:, 1].mean()
    err_ex = abs(ex - sigma / E) / (sigma / E)
    err_ey = abs(ey + nu * sigma / E) / (nu * sigma / E)
    report("axial strain ex = sigma/E", err_ex < 1e-6,
           f"FEM {ex:.6e}, exact {sigma/E:.6e}, rel.err {err_ex:.2e}")
    report("transverse strain ey = -nu*sigma/E", err_ey < 1e-6,
           f"FEM {ey:.6e}, exact {-nu*sigma/E:.6e}, rel.err {err_ey:.2e}")

    rx_sum = R[0::2].sum()
    ry_sum = R[1::2].sum()
    applied = sigma * H * t
    report("force balance: sum Rx = -sigma*H*t",
           abs(rx_sum + applied) / applied < 1e-9,
           f"sum Rx {rx_sum:.6e} N vs {-applied:.6e} N")
    report("force balance: sum Ry = 0", abs(ry_sum) < 1e-6 * applied,
           f"sum Ry {ry_sum:.3e} N")
def check_singularity():
    print("2. Singularity reporting for unconstrained rigid-body modes")
    mat = Material(210e9, 0.3, 0.01)
    nodes, elems = make_rect_mesh(1.0, 0.2, 6, 3)
    K = assemble_stiffness(nodes, elems, mat)
    F = np.zeros(2 * nodes.shape[0])

    cases = [
        ("no BCs at all", np.array([], dtype=int)),
        ("only left-edge ux fixed (y-translation free)",
         2 * boundary_nodes(nodes, "left")),
        ("only one node ux+uy fixed (rotation free)",
         np.array([0, 1])),
    ]
    for name, fixed in cases:
        try:
            solve(nodes, K, F, fixed)
        except SingularSystemError as exc:
            report(f"singular detected: {name}", True, str(exc).split(":")[-1].strip())
        else:
            report(f"singular detected: {name}", False,
                   "solver returned a solution for a singular system!")

    # A statically determinate set must NOT be flagged.
    left = boundary_nodes(nodes, "left")
    corner = left[np.argmin(nodes[left, 1])]
    fixed = np.sort(np.append(2 * left, 2 * corner + 1))
    try:
        solve(nodes, K, F, fixed)
    except SingularSystemError as exc:
        report("well-posed BCs accepted", False, str(exc))
    else:
        report("well-posed BCs accepted", True)


def check_convergence():
    print("3. Mesh-refinement convergence (cantilever vs Timoshenko beam)")
    L, H, t = 4.0, 1.0, 0.1
    E, nu = 1e7, 0.3
    P = 1e3
    mat = Material(E, nu, t)
    I = t * H**3 / 12.0
    G = E / (2 * (1 + nu))
    kappa = 5.0 / 6.0
    delta_exact = P * L**3 / (3 * E * I) + P * L / (kappa * G * t * H)
    print(f"  Timoshenko tip deflection: {delta_exact:.6e} m "
          f"(bending {P*L**3/(3*E*I):.6e} + shear {P*L/(kappa*G*t*H):.6e})")
    print(f"  {'mesh':>10} {'h':>8} {'tip uy (FEM)':>14} {'rel.err':>10} {'rate':>6}")
    prev_err, prev_h = None, None
    errs = []
    for n in (8, 16, 32, 64):
        nx, ny = 4 * n, n
        nodes, elems = make_rect_mesh(L, H, nx, ny)
        fixed, presc, F, _ = cantilever_case(nodes, t, P)
        K = assemble_stiffness(nodes, elems, mat)
        u = solve(nodes, K, F, fixed, presc)
        right = boundary_nodes(nodes, "right")
        tip = -u[1::2][right].mean()
        err = abs(tip - delta_exact) / delta_exact
        h = L / nx
        rate = "" if prev_err is None else f"{np.log(prev_err/err)/np.log(prev_h/h):6.2f}"
        print(f"  {nx:>4}x{ny:<5} {h:8.4f} {tip:14.6e} {err:10.3e} {rate:>6}")
        prev_err, prev_h, errs = err, h, errs + [err]
    report("convergence: error decreases with refinement",
           all(a > b for a, b in zip(errs, errs[1:])),
           f"errors: {[f'{e:.2e}' for e in errs]}")
    report("convergence: finest mesh within 2% of beam theory",
           errs[-1] < 0.02, f"rel.err {errs[-1]:.2e}")


if __name__ == "__main__":
    check_tension()
    print()
    check_singularity()
    print()
    check_convergence()
    print()
    n_fail = results.count(False)
    print(f"summary: {len(results) - n_fail}/{len(results)} checks passed")
    raise SystemExit(1 if n_fail else 0)
