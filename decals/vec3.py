"""Minimal 3D vector helpers on plain tuples (stdlib only)."""

Vec3 = tuple


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def length(a):
    return dot(a, a) ** 0.5


def normalize(a):
    n = length(a)
    if n < 1e-12:
        return (0.0, 0.0, 0.0)
    return (a[0] / n, a[1] / n, a[2] / n)


def lerp(a, b, t):
    return (
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    )


def barycentric(weights, pa, pb, pc):
    wa, wb, wc = weights
    return (
        wa * pa[0] + wb * pb[0] + wc * pc[0],
        wa * pa[1] + wb * pb[1] + wc * pc[1],
        wa * pa[2] + wb * pb[2] + wc * pc[2],
    )
