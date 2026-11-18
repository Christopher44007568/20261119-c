"""Demo: dynamic minimum enclosing ball of a triangle mesh.

Scenario 1 (small mesh): exact vs. approx, batch adds / moves / deletes,
                         support points shown after every batch.
Scenario 2 (large mesh): timing of exact vs. approx as n grows.
Scenario 3 (degenerate): collinear, coplanar, duplicate, extreme scale.
"""

import numpy as np

from meb import Comparison, DynamicMEB, meb_approx, meb_exact


def grid_mesh(nx, ny, z_fn=None):
    """Triangulated grid mesh: returns (vertices, triangles)."""
    xs, ys = np.meshgrid(np.linspace(-1, 1, nx), np.linspace(-1, 1, ny))
    zs = np.zeros_like(xs) if z_fn is None else z_fn(xs, ys)
    verts = np.column_stack([xs.ravel(), ys.ravel(), zs.ravel()])
    tris = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = j * nx + i
            b, c, d = a + 1, a + nx, a + nx + 1
            tris += [(a, b, c), (b, d, c)]
    return verts, np.array(tris)


def show_support(dyn, tag):
    pts = dyn.support_points()
    coords = ", ".join(f"vid{k}={np.round(v, 4).tolist()}" for k, v in pts.items())
    print(f"  [{tag}] support -> {coords}")


def scenario_small():
    print("=" * 78)
    print("Scenario 1: small deforming mesh, exact vs approx, support tracking")
    print("=" * 78)
    rng = np.random.default_rng(7)
    comp = Comparison(eps=1e-3)

    verts, tris = grid_mesh(6, 6, z_fn=lambda x, y: 0.3 * np.sin(3 * x) * np.cos(3 * y))
    comp.exact.triangles = tris
    comp.step("batch1: base mesh", ("add", verts))
    show_support(comp.exact, "exact ")
    show_support(comp.approx, "approx")

    bump = rng.normal(0, 0.2, size=(8, 3)) + [[2.0, 0.0, 0.5]]
    comp.step("batch2: add bump", ("add", bump))
    show_support(comp.exact, "exact ")

    far_id = comp.exact.support_ids[0]
    comp.step("batch3: move support out", ("move", [far_id], [[6.0, 4.0, 2.0]]))
    show_support(comp.exact, "exact ")

    r_before = comp.exact.ball.radius
    comp.step("batch4: delete support", ("remove", [far_id]))
    r_after = comp.exact.ball.radius
    show_support(comp.exact, "exact ")
    print(f"  support deleted -> radius {r_before:.4f} -> {r_after:.4f} "
          f"(rebuilt, not the stale big ball)")

    support_now = set(comp.exact.support_ids)
    inner = [i for i in range(20) if i not in support_now][:3]
    comp.step("batch5: delete non-support", ("remove", inner))
    print(f"  non-support delete -> rebuilt_exact={comp.rows[-1]['rebuilt_exact']} "
          f"(fast path, ball kept)")
    print()
    print(comp.report())
    print()


def scenario_scaling():
    print("=" * 78)
    print("Scenario 2: update time vs mesh size (random surface points)")
    print("=" * 78)
    import time
    rng = np.random.default_rng(1)
    print(f"{'n':>8} {'t_exact(ms)':>12} {'t_approx(ms)':>13} "
          f"{'r_exact':>12} {'r_approx':>12} {'rel_diff':>10} {'err_approx':>11}")
    for n in (500, 2_000, 8_000, 32_000, 128_000):
        pts = rng.normal(size=(n, 3))
        pts[:, 2] *= 0.3  # flat-ish surface cloud
        t0 = time.perf_counter()
        be = meb_exact(pts) if n <= 32_000 else None
        te = (time.perf_counter() - t0) * 1e3
        t0 = time.perf_counter()
        ba = meb_approx(pts, eps=1e-3)
        ta = (time.perf_counter() - t0) * 1e3
        if be is not None:
            rel = (ba.radius - be.radius) / max(1.0, be.radius)
            print(f"{n:>8} {te:>12.2f} {ta:>13.2f} {be.radius:>12.6f} "
                  f"{ba.radius:>12.6f} {rel:>10.2e} {ba.max_violation(pts):>11.2e}")
        else:
            print(f"{n:>8} {'(skipped)':>12} {ta:>13.2f} {'-':>12} "
                  f"{ba.radius:>12.6f} {'-':>10} {ba.max_violation(pts):>11.2e}")
    print()


def scenario_degenerate():
    print("=" * 78)
    print("Scenario 3: degenerate and extreme-scale inputs")
    print("=" * 78)
    t = np.linspace(0, 2 * np.pi, 40, endpoint=False)
    cases = {
        "collinear": np.column_stack([np.linspace(-3, 5, 50),
                                      np.zeros(50), np.zeros(50)]),
        "coplanar circle": np.column_stack([np.cos(t), np.sin(t), np.zeros(40)]),
        "duplicates": np.vstack([np.zeros((10, 3)), np.ones((10, 3)) * 2,
                                 [[1.0, 1.0, 1.0]]]),
        "extreme scale": np.vstack([np.eye(3) * 1e8, -np.eye(3) * 1e-8,
                                    [[0.0, 0.0, 0.0]]]),
        "single point": np.array([[3.0, -2.0, 7.0]]),
    }
    for name, pts in cases.items():
        be = meb_exact(pts)
        ba = meb_approx(pts, eps=1e-4)
        print(f"  {name:<16} exact r={be.radius:.6g} support={be.support} | "
              f"approx r={ba.radius:.6g} err={ba.max_violation(pts):.2e}")
    print()


def scenario_large_dynamic():
    print("=" * 78)
    print("Scenario 4: large mesh (100k vertices), batched dynamic updates")
    print("=" * 78)
    rng = np.random.default_rng(3)
    pts = rng.normal(size=(100_000, 3))
    dyn = DynamicMEB(mode="approx", eps=1e-3)
    dyn.add_points(pts)
    rep = dyn.update()
    print(f"  initial build : n={rep.n_points} r={dyn.ball.radius:.6f} "
          f"t={rep.elapsed*1e3:.1f} ms err={dyn.containment_error():.1e}")
    for k in range(1, 6):
        ids = rng.choice(100_000, size=200, replace=False)
        dyn.move_points(ids, pts[ids] + rng.normal(0, 0.05, (200, 3)))
        rep = dyn.update()
        print(f"  move batch {k}  : rebuilt={rep.rebuilt} "
              f"r={dyn.ball.radius:.6f} t={rep.elapsed*1e3:.1f} ms "
              f"err={dyn.containment_error():.1e}")
    # delete a support point -> must rebuild and shrink honestly
    sid = dyn.support_ids[0]
    dyn.remove_points([sid])
    rep = dyn.update()
    print(f"  delete support: rebuilt={rep.rebuilt} r={dyn.ball.radius:.6f} "
          f"t={rep.elapsed*1e3:.1f} ms err={dyn.containment_error():.1e}")
    print("  (exact Welzl at this size would need >100k recursion depth; "
          "approx warm-start updates stay interactive)")
    print()


if __name__ == "__main__":
    scenario_small()
    scenario_scaling()
    scenario_degenerate()
    scenario_large_dynamic()
