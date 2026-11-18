"""Tiny software rasterizer producing color / depth / object-id buffers."""

import math

from .math3d import mat_mul_point, vec_cross, vec_dot, vec_normalize, vec_sub

SKY_ID = -1


class FrameBuffer:
    def __init__(self, width, height):
        self.width = width
        self.height = height
        n = width * height
        self.color = [(0.0, 0.0, 0.0)] * n
        self.depth = [float("inf")] * n
        self.objid = [SKY_ID] * n

    def clear(self, sky_top=(0.35, 0.55, 0.85), sky_bottom=(0.75, 0.82, 0.92)):
        w, h = self.width, self.height
        for y in range(h):
            t = y / max(1, h - 1)
            r = sky_top[0] + (sky_bottom[0] - sky_top[0]) * t
            g = sky_top[1] + (sky_bottom[1] - sky_top[1]) * t
            b = sky_top[2] + (sky_bottom[2] - sky_top[2]) * t
            base = y * w
            for x in range(w):
                self.color[base + x] = (r, g, b)
        for i in range(w * h):
            self.depth[i] = float("inf")
            self.objid[i] = SKY_ID


LIGHT_DIR = vec_normalize((0.5, 0.8, 0.3))


def _shade(base_color, normal_world):
    d = max(0.0, vec_dot(normal_world, LIGHT_DIR))
    amb = 0.25
    k = amb + (1.0 - amb) * d
    return (base_color[0] * k, base_color[1] * k, base_color[2] * k)


def _transform_normal(m, n):
    # Rotation-only normal transform (scene uses rigid transforms + uniform scale).
    x, y, z = n
    return vec_normalize((
        m[0] * x + m[1] * y + m[2] * z,
        m[4] * x + m[5] * y + m[6] * z,
        m[8] * x + m[9] * y + m[10] * z,
    ))


def render_scene(fb, objects, camera):
    """Rasterize all objects into the framebuffer (painterless z-buffer)."""
    w, h = fb.width, fb.height
    for obj_id, obj in enumerate(objects):
        mvp = None  # computed lazily per object below
        from .math3d import mat_mul
        mvp = mat_mul(camera.view_proj, obj.model)
        for (v0, v1, v2, n) in obj.triangles:
            c0 = mat_mul_point(mvp, v0)
            c1 = mat_mul_point(mvp, v1)
            c2 = mat_mul_point(mvp, v2)
            if c0[3] <= 1e-6 or c1[3] <= 1e-6 or c2[3] <= 1e-6:
                continue  # behind the near plane; demo scene avoids clipping
            s0 = _to_screen(c0, w, h)
            s1 = _to_screen(c1, w, h)
            s2 = _to_screen(c2, w, h)
            n_world = _transform_normal(obj.model, n)
            color = _shade(obj.color, n_world)
            _raster_triangle(fb, s0, s1, s2, color, obj_id)


def _to_screen(clip, w, h):
    inv_w = 1.0 / clip[3]
    ndc_x = clip[0] * inv_w
    ndc_y = clip[1] * inv_w
    ndc_z = clip[2] * inv_w
    return (
        (ndc_x * 0.5 + 0.5) * w,
        (0.5 - ndc_y * 0.5) * h,
        ndc_z,
    )


def _raster_triangle(fb, s0, s1, s2, color, obj_id):
    w, h = fb.width, fb.height
    x0, y0, z0 = s0
    x1, y1, z1 = s1
    x2, y2, z2 = s2
    area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if abs(area) < 1e-9:
        return
    inv_area = 1.0 / area
    min_x = max(0, int(math.floor(min(x0, x1, x2))))
    max_x = min(w - 1, int(math.ceil(max(x0, x1, x2))))
    min_y = max(0, int(math.floor(min(y0, y1, y2))))
    max_y = min(h - 1, int(math.ceil(max(y0, y1, y2))))
    depth = fb.depth
    objid = fb.objid
    colbuf = fb.color
    for y in range(min_y, max_y + 1):
        py = y + 0.5
        row = y * w
        for x in range(min_x, max_x + 1):
            px = x + 0.5
            w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv_area
            w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv_area
            w2 = 1.0 - w0 - w1
            if w0 < 0.0 or w1 < 0.0 or w2 < 0.0:
                continue
            z = w0 * z0 + w1 * z1 + w2 * z2
            i = row + x
            if z < depth[i]:
                depth[i] = z
                objid[i] = obj_id
                colbuf[i] = color
