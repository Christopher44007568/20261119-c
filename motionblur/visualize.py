"""Turn velocity fields and color buffers into displayable RGB images."""

import math


def velocity_to_rgb(field, scale=None):
    """Velocity visualization: x -> red, y -> green, magnitude -> blue gain.

    Zero velocity maps to mid-gray so static regions are easy to spot.
    """
    if scale is None:
        scale = 1.0
        for vx, vy in field:
            scale = max(scale, abs(vx), abs(vy))
    out = bytearray()
    for vx, vy in field:
        r = 0.5 + 0.5 * (vx / scale)
        g = 0.5 + 0.5 * (vy / scale)
        mag = math.hypot(vx, vy) / scale
        out += bytes((
            _clamp8(r * 255),
            _clamp8(g * 255),
            _clamp8((0.5 + 0.5 * mag) * 255),
        ))
    return out


def color_to_rgb(color):
    out = bytearray()
    for r, g, b in color:
        out += bytes((_clamp8(r * 255), _clamp8(g * 255), _clamp8(b * 255)))
    return out


def _clamp8(v):
    return 0 if v < 0 else (255 if v > 255 else int(v + 0.5))
