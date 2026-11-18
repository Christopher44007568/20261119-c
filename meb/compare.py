"""Side-by-side comparison of exact vs. approximate dynamic MEB.

Feeds the same batches (add / move / remove) to two DynamicMEB instances
and records per-step radius, radius difference, containment error and
wall-clock update time.
"""

from __future__ import annotations

import numpy as np

from .dynamic import DynamicMEB


class Comparison:
    def __init__(self, eps=1e-3):
        self.exact = DynamicMEB(mode="exact")
        self.approx = DynamicMEB(mode="approx", eps=eps)
        self.rows = []

    def _apply(self, op):
        kind = op[0]
        for dyn in (self.exact, self.approx):
            if kind == "add":
                dyn.add_points(op[1], ids=op[2] if len(op) > 2 else None)
            elif kind == "move":
                dyn.move_points(op[1], op[2])
            elif kind == "remove":
                dyn.remove_points(op[1])
        return kind

    def step(self, label, op):
        kind = self._apply(op)
        re = self.exact.update()
        ra = self.approx.update()
        r_exact = re.ball.radius
        r_approx = ra.ball.radius
        scale = max(1.0, r_exact)
        row = {
            "label": label,
            "op": kind,
            "n": re.n_points,
            "r_exact": r_exact,
            "r_approx": r_approx,
            "rel_radius_diff": (r_approx - r_exact) / scale,
            "contain_err_exact": self.exact.containment_error(),
            "contain_err_approx": self.approx.containment_error(),
            "t_exact_ms": re.elapsed * 1e3,
            "t_approx_ms": ra.elapsed * 1e3,
            "rebuilt_exact": re.rebuilt,
            "rebuilt_approx": ra.rebuilt,
            "support_exact": self.exact.support_ids,
            "support_approx": self.approx.support_ids,
        }
        self.rows.append(row)
        return row

    def report(self):
        hdr = (f"{'step':<22} {'op':<7} {'n':>6} {'r_exact':>12} {'r_approx':>12} "
               f"{'rel_diff':>9} {'err_ex':>9} {'err_ap':>9} "
               f"{'t_ex(ms)':>9} {'t_ap(ms)':>9}  support(exact)")
        lines = [hdr, "-" * len(hdr)]
        for r in self.rows:
            lines.append(
                f"{r['label']:<22} {r['op']:<7} {r['n']:>6} "
                f"{r['r_exact']:>12.6g} {r['r_approx']:>12.6g} "
                f"{r['rel_radius_diff']:>9.2e} "
                f"{r['contain_err_exact']:>9.2e} {r['contain_err_approx']:>9.2e} "
                f"{r['t_exact_ms']:>9.3f} {r['t_approx_ms']:>9.3f}  "
                f"{r['support_exact']}"
            )
        return "\n".join(lines)
