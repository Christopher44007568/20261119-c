"""Velocity buffer: reconstruct per-pixel motion vectors from the current
depth buffer plus frame history (previous view-projection and previous
per-object model matrices).

Three velocity fields are produced, in pixels per second:

  camera : camera motion only (translation + rotation), computed by
           reprojecting the current world position through the previous
           view-projection matrix.
  object : object motion only, computed by transforming the world
           position into the object's previous-frame location while
           keeping the CURRENT camera fixed.
  total  : combined velocity using prev view-proj * prev model, which is
           what the motion-blur pass samples along.

Static objects (dynamic=False) and the sky only carry camera velocity;
the HUD is rendered later and never enters these buffers.
"""

import math

from .math3d import mat_mul_point, mat_mul_vec4
from .raster import SKY_ID


class VelocityBuffer:
    def __init__(self, width, height):
        n = width * height
        self.width = width
        self.height = height
        self.camera = [(0.0, 0.0)] * n
        self.object = [(0.0, 0.0)] * n
        self.total = [(0.0, 0.0)] * n


def _ndc_to_world(inv_view_proj, ndc_x, ndc_y, ndc_z):
    x, y, z, w = mat_mul_vec4(inv_view_proj, (ndc_x, ndc_y, ndc_z, 1.0))
    if abs(w) < 1e-12:
        return (0.0, 0.0, 0.0)
    return (x / w, y / w, z / w)


def _world_to_screen(view_proj, world, width, height):
    cx, cy, cz, cw = mat_mul_point(view_proj, world)
    if abs(cw) < 1e-12:
        return None
    ndc_x = cx / cw
    ndc_y = cy / cw
    return ((ndc_x * 0.5 + 0.5) * width, (0.5 - ndc_y * 0.5) * height)


def _previous_world_position(obj, world):
    """Map a current-frame world position back through the object's
    previous-frame model matrix."""
    lx, ly, lz, lw = mat_mul_vec4(obj.inv_model, (world[0], world[1], world[2], 1.0))
    if abs(lw) < 1e-12:
        return world
    px, py, pz, pw = mat_mul_point(obj.prev_model, (lx / lw, ly / lw, lz / lw))
    if abs(pw) < 1e-12:
        return world
    return (px / pw, py / pw, pz / pw)


def compute_velocity_buffer(fb, objects, camera, history):
    """Build the velocity buffer for the current frame.

    Velocities are expressed in pixels/second so the blur pass can scale
    them by the shutter exposure time regardless of frame rate.
    """
    w, h = fb.width, fb.height
    vb = VelocityBuffer(w, h)
    dt = max(history.dt, 1e-6)
    inv_dt = 1.0 / dt
    first_frame = history.frame_index < 0

    for y in range(h):
        ndc_y = (0.5 - (y + 0.5) / h) * 2.0
        row = y * w
        for x in range(w):
            i = row + x
            ndc_x = ((x + 0.5) / w) * 2.0 - 1.0
            depth = fb.depth[i]
            ndc_z = depth if depth != float("inf") else 1.0
            world = _ndc_to_world(camera.inv_view_proj, ndc_x, ndc_y, ndc_z)

            if first_frame:
                continue  # no history yet: zero velocity everywhere

            # Camera velocity (rotation + translation).
            prev_scr = _world_to_screen(camera.prev_view_proj, world, w, h)
            cam_vel = (0.0, 0.0)
            if prev_scr is not None:
                cam_vel = (
                    (prev_scr[0] - (x + 0.5)) * inv_dt,
                    (prev_scr[1] - (y + 0.5)) * inv_dt,
                )
            vb.camera[i] = cam_vel

            # Object velocity (current camera, previous model matrix).
            obj_id = fb.objid[i]
            obj_vel = (0.0, 0.0)
            world_prev = world
            if obj_id != SKY_ID and objects[obj_id].dynamic:
                obj = objects[obj_id]
                world_prev = _previous_world_position(obj, world)
                prev_obj_scr = _world_to_screen(camera.view_proj, world_prev, w, h)
                if prev_obj_scr is not None:
                    obj_vel = (
                        (prev_obj_scr[0] - (x + 0.5)) * inv_dt,
                        (prev_obj_scr[1] - (y + 0.5)) * inv_dt,
                    )
            vb.object[i] = obj_vel

            # Total velocity (previous camera + previous model matrix).
            total_vel = cam_vel
            prev_tot_scr = _world_to_screen(camera.prev_view_proj, world_prev, w, h)
            if prev_tot_scr is not None:
                total_vel = (
                    (prev_tot_scr[0] - (x + 0.5)) * inv_dt,
                    (prev_tot_scr[1] - (y + 0.5)) * inv_dt,
                )
            vb.total[i] = total_vel

    return vb


def max_magnitude(field):
    m = 0.0
    for vx, vy in field:
        m = max(m, math.hypot(vx, vy))
    return m
