"""Self-checks for the motion-vector motion-blur pipeline.

Covers the requirements:
  1. static scene + static camera  -> zero velocity, no smear
  2. moving object, static camera  -> object velocity only
  3. rotating camera               -> camera velocity only for statics
  4. shutter-time scaling          -> sample distance scales with dt
  5. HUD                           -> never enters the velocity buffer
"""

import math

from motionblur.blur import motion_blur
from motionblur.geometry import cube_triangles
from motionblur.hud import draw_hud
from motionblur.math3d import (
    mat_identity,
    mat_inverse,
    mat_mul,
    mat_mul_point,
    mat_rotation_y,
    mat_translation,
)
from motionblur.raster import FrameBuffer, render_scene
from motionblur.scene import Camera, FrameHistory, Object3D
from motionblur.velocity import compute_velocity_buffer, max_magnitude

W, H = 160, 90
EPS = 1e-6


def check(name, cond):
    print(("PASS" if cond else "FAIL"), name)
    if not cond:
        raise SystemExit(f"selftest failed: {name}")


def make_cam():
    return Camera(math.radians(60), W / H, 0.1, 100.0)


def render_pair(move_object=False, rotate_camera=False, dt=1 / 60):
    """Render two frames; return (fb, objects, cam, history)."""
    obj = Object3D("cube", cube_triangles(), (0.8, 0.3, 0.2), dynamic=True)
    cam = make_cam()
    hist = FrameHistory()
    fb = FrameBuffer(W, H)
    for frame in range(2):
        t = frame * dt
        m = mat_translation(0.0, 0.5, 0.0)
        if move_object:
            m = mat_mul(mat_translation(3.0 * t, 0.5, 0.0), mat_rotation_y(4.0 * t))
        obj.update(m)
        yaw = (1.5 * t) if rotate_camera else 0.0
        cam.update((8.0 * math.sin(yaw), 3.0, 8.0 * math.cos(yaw)), (0.0, 0.5, 0.0))
        fb.clear()
        render_scene(fb, [obj], cam)
        if frame == 0:
            hist.advance(list(fb.depth), dt)
    return fb, [obj], cam, hist


def test_math():
    m = mat_mul(mat_translation(1, 2, 3), mat_rotation_y(0.7))
    ident = mat_mul(m, mat_inverse(m))
    for a, b in zip(ident, mat_identity()):
        check("matrix inverse round-trip", abs(a - b) < 1e-9)
    p = mat_mul_point(mat_mul(mat_inverse(m), m), (0.3, -0.2, 0.9))
    check("inverse(m)*m keeps point", all(abs(a - b) < 1e-9 for a, b in zip(p[:3], (0.3, -0.2, 0.9))))


def test_static_scene_no_smear():
    fb, objects, cam, hist = render_pair(move_object=False, rotate_camera=False)
    vb = compute_velocity_buffer(fb, objects, cam, hist)
    check("static: camera velocity zero", max_magnitude(vb.camera) < 1e-6)
    check("static: object velocity zero", max_magnitude(vb.object) < 1e-6)
    check("static: total velocity zero", max_magnitude(vb.total) < 1e-6)
    blurred = motion_blur(fb.color, vb.total, W, H, hist.dt, 0.5)
    check("static: blur is identity", all(a == b for a, b in zip(blurred, fb.color)))


def test_object_motion_separated():
    fb, objects, cam, hist = render_pair(move_object=True, rotate_camera=False)
    vb = compute_velocity_buffer(fb, objects, cam, hist)
    check("object moves: object velocity nonzero", max_magnitude(vb.object) > 1.0)
    check("object moves: camera velocity zero", max_magnitude(vb.camera) < 1e-6)


def test_camera_rotation_separated():
    fb, objects, cam, hist = render_pair(move_object=False, rotate_camera=True)
    vb = compute_velocity_buffer(fb, objects, cam, hist)
    check("camera rotates: camera velocity nonzero", max_magnitude(vb.camera) > 1.0)
    check("camera rotates: object velocity zero", max_magnitude(vb.object) < 1e-6)


def test_shutter_time_scaling():
    # Constant velocity field: blur of a hard edge widens linearly with dt.
    w, h = 64, 8
    color = [(1.0, 1.0, 1.0) if x < w // 2 else (0.0, 0.0, 0.0) for y in range(h) for x in range(w)]
    vel = [(600.0, 0.0)] * (w * h)  # px/s, frame-rate independent

    def edge_width(dt):
        out = motion_blur(color, vel, w, h, dt, shutter_fraction=0.5)
        row = out[(h // 2) * w:(h // 2) * w + w]
        return sum(1 for (r, g, b) in row if 0.05 < r < 0.95)

    w1 = edge_width(1 / 60)
    w2 = edge_width(1 / 30)
    check("shutter scaling: longer frame -> wider smear", w2 > w1)
    check("shutter scaling: ~2x dt -> ~2x smear", 1.5 < w2 / max(1, w1) < 2.5)


def test_hud_excluded():
    fb, objects, cam, hist = render_pair(move_object=True, rotate_camera=True)
    vb_before = compute_velocity_buffer(fb, objects, cam, hist)
    snapshot = (list(vb_before.camera), list(vb_before.object), list(vb_before.total))

    blurred = motion_blur(fb.color, vb_before.total, W, H, hist.dt, 0.5)
    final = list(blurred)
    draw_hud(final, W, H, fps=60)

    vb_after = compute_velocity_buffer(fb, objects, cam, hist)
    check("HUD does not touch velocity buffer",
          snapshot[0] == vb_after.camera
          and snapshot[1] == vb_after.object
          and snapshot[2] == vb_after.total)

    cx, cy = W // 2, H // 2
    check("HUD crosshair pixel is exact HUD color (unblurred)",
          final[cy * W + cx - 5] == (1.0, 1.0, 1.0))
    check("HUD drawn over blurred scene", any(
        final[i] != blurred[i] for i in range(W * H)))


def test_history_depth_kept():
    hist = FrameHistory()
    depth = [0.5] * 16
    hist.advance(depth, 1 / 60)
    check("history keeps previous depth", hist.prev_depth == depth)
    check("history keeps frame dt", abs(hist.dt - 1 / 60) < EPS)


if __name__ == "__main__":
    test_math()
    test_static_scene_no_smear()
    test_object_motion_separated()
    test_camera_rotation_separated()
    test_shutter_time_scaling()
    test_hud_excluded()
    test_history_depth_kept()
    print("all selftests passed")
