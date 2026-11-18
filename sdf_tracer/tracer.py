"""Sphere marching (ray marching of an SDF) with distance-bound estimates."""
import math

from . import vecmath as vm

HIT_SURFACE = "HIT_SURFACE"
OVER_STEPS = "OVER_STEPS"
FAR_PLANE = "FAR_PLANE"
DEGENERATE = "DEGENERATE"


def finite(v):
    return not (math.isnan(v) or math.isinf(v))


def sphere_march(scene, origin, direction,
                 max_steps=64, eps_abs=1e-4, eps_rel=1e-4,
                 far=20.0, record=False):
    """March a ray against `scene`.

    Works for origins both outside and inside the surface (the signed
    distance is used as an unsigned step magnitude, so an interior camera
    keeps moving until it reaches the exit surface).

    Returns a dict with the travelled distance, termination reason, number
    of steps, smallest |distance| observed, and (optionally) the full
    per-step trace: each entry holds (step_index, t, signed_distance,
    step_size).
    """
    d = vm.norm(direction)
    t = 0.0
    min_abs_dist = math.inf
    trace = [] if record else None

    if vm.dot(d, d) <= 1e-30:
        return _result(0.0, DEGENERATE, 0, math.inf, trace, origin)

    for step in range(1, max_steps + 1):
        p = (origin[0] + d[0] * t,
             origin[1] + d[1] * t,
             origin[2] + d[2] * t)
        dist, prim_id = scene.eval_id(p)

        if not finite(dist):
            return _result(t, DEGENERATE, step, min_abs_dist, trace, p)

        if record:
            trace.append((step, t, dist, abs(dist)))
        if abs(dist) < min_abs_dist:
            min_abs_dist = abs(dist)

        threshold = eps_abs + eps_rel * t
        if abs(dist) <= threshold:
            return _result(t, HIT_SURFACE, step, min_abs_dist, trace, p,
                           prim_id)

        t += abs(dist)
        if t > far:
            return _result(t, FAR_PLANE, step, min_abs_dist, trace, p)

    return _result(t, OVER_STEPS, max_steps, min_abs_dist, trace, None)


def _result(t, reason, steps, min_dist, trace, point, prim_id=None):
    return {
        "t": t,
        "reason": reason,
        "steps": steps,
        "min_distance": min_dist,
        "trace": trace,
        "point": point,
        "prim_id": prim_id,
    }


def normal_gradient(scene, p, base_eps=1e-4):
    """Numerical SDF normal via tetrahedron central differences.

    Guards every component against NaN/Inf: the finite-difference offset is
    scaled to the local feature size, non-finite samples are replaced by
    forward differences, and a deterministic fallback axis is returned if
    the gradient collapses to zero so callers never receive NaN normals.
    """
    scale = max(base_eps, 1e-6 * (1.0 + vm.length(p)))
    k1 = (1.0, -1.0, -1.0)
    k2 = (-1.0, -1.0, 1.0)
    k3 = (-1.0, 1.0, -1.0)
    k4 = (1.0, 1.0, 1.0)

    def sample(k):
        q = (p[0] + k[0] * scale,
             p[1] + k[1] * scale,
             p[2] + k[2] * scale)
        v = scene(q)
        if not finite(v):
            v = _forward_fallback(scene, p, k, scale)
        return v

    vals = (sample(k1), sample(k2), sample(k3), sample(k4))
    grad = ((vals[0] - vals[1] - vals[2] + vals[3]),
            (-vals[0] - vals[1] + vals[2] + vals[3]),
            (-vals[0] + vals[1] - vals[2] + vals[3]))

    if not all(finite(g) for g in grad):
        return _axis_fallback(p)
    n = vm.norm(grad)
    if vm.dot(n, n) <= 0.0:
        return _axis_fallback(p)
    return n


def _forward_fallback(scene, p, k, scale):
    center = scene(p)
    q = (p[0] + k[0] * scale, p[1] + k[1] * scale, p[2] + k[2] * scale)
    v = scene(q)
    if not finite(v) or not finite(center):
        return 0.0
    return center + (v - center)


def _axis_fallback(p):
    axis = (1.0, 0.0, 0.0) if abs(p[0]) <= abs(p[1]) else (0.0, 1.0, 0.0)
    return axis


def ray_sphere(origin, direction, radius):
    """Analytic ray/sphere intersection.

    Returns (t_enter, t_exit); roots behind the ray are returned as None.
    When the origin is inside the sphere, t_enter is None and t_exit gives
    the distance to the exit surface.
    """
    d = vm.norm(direction)
    b = vm.dot(origin, d)
    c = vm.dot(origin, origin) - radius * radius
    disc = b * b - c
    if disc < 0.0:
        return (None, None)
    root = math.sqrt(disc)
    t0 = -b - root
    t1 = -b + root
    enter = t0 if t0 > 0.0 else None
    exit_t = t1 if t1 > 0.0 else None
    return (enter, exit_t)


def validate_hit(scene, origin, direction, march_result, tol_abs=0.05):
    """Compare the marched hit against the analytic sphere intersection.

    The validation sphere bounds the composite scene, so a marched hit must
    not land beyond the analytic exit point. Rays that never hit the scene
    are skipped rather than treated as violations. Returns a dict with both
    distances, their signed difference and whether the bound is satisfied.
    """
    _, analytic_exit = ray_sphere(vm.sub(origin, scene.center),
                                  direction, scene.sphere_radius)
    marched = march_result["t"] if march_result["reason"] == HIT_SURFACE \
        else None
    if marched is None:
        ok = True
        delta = None
    else:
        delta = marched - analytic_exit
        ok = delta <= tol_abs
    return {
        "marched_t": marched,
        "analytic_t": analytic_exit,
        "delta": delta,
        "within_bound": ok,
    }
