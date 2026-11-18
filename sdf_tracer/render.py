"""Frame renderer: marches every pixel and classifies termination reasons."""
from . import vecmath as vm
from . import tracer

# Background gradient vs. explicit over-step marker color. Over-step pixels
# are rendered magenta so they can never be mistaken for ordinary background.
BG_TOP = (0.05, 0.07, 0.11)
BG_BOTTOM = (0.16, 0.20, 0.28)
OVER_STEP_COLOR = (1.0, 0.0, 0.85)
DEGENERATE_COLOR = (1.0, 1.0, 0.0)
TORUS_COLOR = (0.85, 0.35, 0.20)
BOX_COLOR = (0.25, 0.55, 0.85)
LIGHT_DIR = vm.norm((0.6, 0.8, 0.4))


def shade(scene, result):
    """Lambert + ambient + rim shading, tinted by dominant primitive."""
    point = result["point"]
    normal = tracer.normal_gradient(scene, point)
    base = TORUS_COLOR if result["prim_id"] == scene.TORUS else BOX_COLOR
    diffuse = max(vm.dot(normal, LIGHT_DIR), 0.0)
    view = vm.norm(vm.mul(point, -1.0))
    rim = 1.0 - max(vm.dot(normal, view), 0.0)
    shaded = tuple(vm.clamp(0.18 * c + 0.85 * diffuse * c + 0.25 * rim * c,
                            0.0, 1.0) for c in base)
    return shaded, normal


def background(v):
    t = 0.5 * (v + 1.0)
    return vm.lerp(BG_BOTTOM, BG_TOP, t)


def render(scene, camera, width, height, max_steps=64, far=20.0,
           debug_pixels=None):
    """Return (rows, stats, debug_reports).

    rows: list of bytearray rows (RGB, 8-bit).
    stats: pixel counts keyed by termination reason.
    debug_reports: list of (pixel, ray, march_result, validation) tuples.
    """
    camera.set_aspect(width / height)
    debug_pixels = set(debug_pixels or ())
    stats = {tracer.HIT_SURFACE: 0, tracer.OVER_STEPS: 0,
             tracer.FAR_PLANE: 0, tracer.DEGENERATE: 0}
    debug_reports = []
    rows = []

    for py in range(height):
        row = bytearray(width * 3)
        v = 1.0 - 2.0 * (py + 0.5) / height
        for px in range(width):
            u = 2.0 * (px + 0.5) / width - 1.0
            origin, direction = camera.ray(u, v)
            want_debug = (px, py) in debug_pixels
            result = tracer.sphere_march(scene, origin, direction,
                                         max_steps=max_steps, far=far,
                                         record=want_debug)
            stats[result["reason"]] += 1
            color = _color_for(scene, result, v)
            offset = px * 3
            row[offset] = int(color[0] * 255)
            row[offset + 1] = int(color[1] * 255)
            row[offset + 2] = int(color[2] * 255)

            if want_debug:
                validation = tracer.validate_hit(scene, origin,
                                                 direction, result)
                debug_reports.append(((px, py), (origin, direction),
                                      result, validation))
        rows.append(row)
    return rows, stats, debug_reports


def _color_for(scene, result, v):
    reason = result["reason"]
    if reason == tracer.HIT_SURFACE:
        return shade(scene, result)[0]
    if reason == tracer.OVER_STEPS:
        return OVER_STEP_COLOR
    if reason == tracer.DEGENERATE:
        return DEGENERATE_COLOR
    return background(v)
