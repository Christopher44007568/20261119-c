"""Motion-vector motion-blur demo.

Renders a short sequence with a rotating camera, a moving cube and a
static cube, then writes per-frame:

  out/frame_NN_final.png       final image (scene blurred, HUD sharp)
  out/frame_NN_vel_camera.png  camera-only velocity map
  out/frame_NN_vel_object.png  object-only velocity map
  out/frame_NN_vel_total.png   total velocity map (used by the blur pass)

Frame 00 is a fully static sanity frame (no blur anywhere). Later frames
use varying frame times to demonstrate shutter-time scaling.
"""

import math
import os
import sys
import time

from motionblur.blur import motion_blur
from motionblur.geometry import cube_triangles, plane_triangles
from motionblur.hud import draw_hud
from motionblur.math3d import mat_mul, mat_rotation_y, mat_translation
from motionblur.png import write_png
from motionblur.raster import FrameBuffer, render_scene
from motionblur.scene import Camera, FrameHistory, Object3D
from motionblur.velocity import compute_velocity_buffer, max_magnitude
from motionblur.visualize import color_to_rgb, velocity_to_rgb

WIDTH, HEIGHT = 320, 180
SHUTTER_FRACTION = 0.5  # 180-degree shutter
OUT_DIR = "out"


def build_scene():
    ground = Object3D("ground", plane_triangles(), (0.42, 0.46, 0.40), dynamic=False)
    mover = Object3D("mover", cube_triangles(), (0.80, 0.28, 0.20), dynamic=True)
    still = Object3D("still", cube_triangles(), (0.25, 0.45, 0.80), dynamic=False)
    still.update(mat_translation(2.2, 0.5, -1.0))
    return [ground, mover, still]


def mover_model(t):
    return mat_mul(
        mat_translation(-2.0 + 6.0 * t, 0.5 + 0.4 * math.sin(3.0 * t), 0.0),
        mat_rotation_y(6.0 * t),
    )


def camera_pose(t):
    yaw = 1.8 * t
    eye = (8.0 * math.sin(yaw), 3.0, 8.0 * math.cos(yaw))
    return eye, (0.0, 0.5, 0.0)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    # (dt per frame) — frame rate changes mid-sequence on purpose.
    dts = [1 / 60, 1 / 60, 1 / 60, 1 / 30, 1 / 30, 1 / 20]
    objects = build_scene()
    mover = objects[1]
    cam = Camera(math.radians(60), WIDTH / HEIGHT, 0.1, 100.0)
    history = FrameHistory()
    fb = FrameBuffer(WIDTH, HEIGHT)

    t = 0.0
    for frame, dt in enumerate(dts):
        t0 = time.time()
        mover.update(mover_model(t))
        eye, target = camera_pose(t)
        cam.update(eye, target)

        fb.clear()
        render_scene(fb, objects, cam)

        vb = compute_velocity_buffer(fb, objects, cam, history)
        blurred = motion_blur(fb.color, vb.total, WIDTH, HEIGHT, dt, SHUTTER_FRACTION)

        final = list(blurred)
        draw_hud(final, WIDTH, HEIGHT, fps=round(1.0 / dt))

        tag = f"{OUT_DIR}/frame_{frame:02d}"
        write_png(tag + "_final.png", WIDTH, HEIGHT, color_to_rgb(final))
        write_png(tag + "_vel_camera.png", WIDTH, HEIGHT, velocity_to_rgb(vb.camera))
        write_png(tag + "_vel_object.png", WIDTH, HEIGHT, velocity_to_rgb(vb.object))
        write_png(tag + "_vel_total.png", WIDTH, HEIGHT, velocity_to_rgb(vb.total))

        history.advance(list(fb.depth), dt)
        t += dt
        print(
            f"frame {frame:02d} dt={dt*1000:5.1f}ms "
            f"|v|max cam={max_magnitude(vb.camera):7.1f} "
            f"obj={max_magnitude(vb.object):7.1f} "
            f"tot={max_magnitude(vb.total):7.1f} px/s "
            f"({time.time()-t0:.1f}s)"
        )
    print(f"wrote {len(dts)} frames to {OUT_DIR}/")


if __name__ == "__main__":
    sys.exit(main())
