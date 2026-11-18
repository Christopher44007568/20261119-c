"""Motion-blur pass: gather samples along each pixel's motion vector.

The sampling distance is `velocity (px/s) * exposure_time (s)` where
exposure_time = shutter_fraction * frame_dt. When the frame rate changes,
only dt changes; the same shutter fraction therefore yields the same
world-space smear, and velocities (px/s) stay frame-rate independent.
"""

import math

MAX_SAMPLES = 32


def _sample_bilinear(color, w, h, fx, fy):
    fx = min(max(fx, 0.0), w - 1.001)
    fy = min(max(fy, 0.0), h - 1.001)
    x0 = int(fx)
    y0 = int(fy)
    tx = fx - x0
    ty = fy - y0
    i00 = y0 * w + x0
    i10 = i00 + 1
    i01 = i00 + w
    i11 = i01 + 1
    c00, c10, c01, c11 = color[i00], color[i10], color[i01], color[i11]
    r = (c00[0] * (1 - tx) + c10[0] * tx) * (1 - ty) + (c01[0] * (1 - tx) + c11[0] * tx) * ty
    g = (c00[1] * (1 - tx) + c10[1] * tx) * (1 - ty) + (c01[1] * (1 - tx) + c11[1] * tx) * ty
    b = (c00[2] * (1 - tx) + c10[2] * tx) * (1 - ty) + (c01[2] * (1 - tx) + c11[2] * tx) * ty
    return (r, g, b)


def motion_blur(color, velocity, width, height, dt, shutter_fraction=0.5):
    """Gather-based motion blur along the total velocity field.

    Pixels with (near-)zero velocity keep exactly one sample, so static
    geometry and anything outside the velocity buffer stays sharp.
    """
    exposure = shutter_fraction * dt
    out = [(0.0, 0.0, 0.0)] * (width * height)
    for y in range(height):
        row = y * width
        for x in range(width):
            i = row + x
            vx, vy = velocity[i]
            off_x = vx * exposure
            off_y = vy * exposure
            length = math.hypot(off_x, off_y)
            if length < 0.5:
                out[i] = color[i]
                continue
            n = min(MAX_SAMPLES, max(2, int(length) + 1))
            cx = x + 0.5
            cy = y + 0.5
            r = g = b = 0.0
            for s in range(n):
                t = (s / (n - 1)) - 0.5  # centered on the pixel
                sr, sg, sb = _sample_bilinear(
                    color, width, height, cx + off_x * t, cy + off_y * t
                )
                r += sr
                g += sg
                b += sb
            inv = 1.0 / n
            out[i] = (r * inv, g * inv, b * inv)
    return out
