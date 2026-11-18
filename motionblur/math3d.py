"""Minimal 4x4 matrix / vector helpers (pure Python, column vectors).

Matrices are flat lists of 16 floats in row-major order; points are
column vectors transformed as p' = M * p.
"""

import math


def mat_identity():
    return [
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ]


def mat_mul(a, b):
    """Return a * b (apply b first, then a)."""
    out = [0.0] * 16
    for r in range(4):
        for c in range(4):
            out[r * 4 + c] = (
                a[r * 4 + 0] * b[0 * 4 + c]
                + a[r * 4 + 1] * b[1 * 4 + c]
                + a[r * 4 + 2] * b[2 * 4 + c]
                + a[r * 4 + 3] * b[3 * 4 + c]
            )
    return out


def mat_mul_point(m, p):
    """Transform (x, y, z) as a point (w=1), return (x, y, z, w)."""
    x, y, z = p
    return (
        m[0] * x + m[1] * y + m[2] * z + m[3],
        m[4] * x + m[5] * y + m[6] * z + m[7],
        m[8] * x + m[9] * y + m[10] * z + m[11],
        m[12] * x + m[13] * y + m[14] * z + m[15],
    )


def mat_mul_vec4(m, v):
    x, y, z, w = v
    return (
        m[0] * x + m[1] * y + m[2] * z + m[3] * w,
        m[4] * x + m[5] * y + m[6] * z + m[7] * w,
        m[8] * x + m[9] * y + m[10] * z + m[11] * w,
        m[12] * x + m[13] * y + m[14] * z + m[15] * w,
    )


def mat_inverse(m):
    """General 4x4 inverse via Gauss-Jordan elimination."""
    aug = [[m[r * 4 + c] for c in range(4)] + [1.0 if r == c else 0.0 for c in range(4)] for r in range(4)]
    for col in range(4):
        piv = max(range(col, 4), key=lambda r: abs(aug[r][col]))
        if abs(aug[piv][col]) < 1e-12:
            raise ValueError("matrix is singular")
        aug[col], aug[piv] = aug[piv], aug[col]
        inv = 1.0 / aug[col][col]
        aug[col] = [v * inv for v in aug[col]]
        for r in range(4):
            if r != col and aug[r][col] != 0.0:
                f = aug[r][col]
                aug[r] = [a - f * b for a, b in zip(aug[r], aug[col])]
    return [aug[r][4 + c] for r in range(4) for c in range(4)]


def mat_translation(tx, ty, tz):
    m = mat_identity()
    m[3], m[7], m[11] = tx, ty, tz
    return m


def mat_scale(sx, sy, sz):
    m = mat_identity()
    m[0], m[5], m[10] = sx, sy, sz
    return m


def mat_rotation_x(a):
    c, s = math.cos(a), math.sin(a)
    return [
        1.0, 0.0, 0.0, 0.0,
        0.0, c, -s, 0.0,
        0.0, s, c, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ]


def mat_rotation_y(a):
    c, s = math.cos(a), math.sin(a)
    return [
        c, 0.0, s, 0.0,
        0.0, 1.0, 0.0, 0.0,
        -s, 0.0, c, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ]


def mat_rotation_z(a):
    c, s = math.cos(a), math.sin(a)
    return [
        c, -s, 0.0, 0.0,
        s, c, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0,
    ]


def mat_perspective(fov_y_rad, aspect, near, far):
    """Right-handed perspective, camera looks down -Z, NDC z in [0, 1]."""
    f = 1.0 / math.tan(fov_y_rad * 0.5)
    return [
        f / aspect, 0.0, 0.0, 0.0,
        0.0, f, 0.0, 0.0,
        0.0, 0.0, far / (near - far), near * far / (near - far),
        0.0, 0.0, -1.0, 0.0,
    ]


def mat_look_at(eye, target, up):
    fx, fy, fz = (target[0] - eye[0], target[1] - eye[1], target[2] - eye[2])
    fl = math.sqrt(fx * fx + fy * fy + fz * fz)
    fx, fy, fz = fx / fl, fy / fl, fz / fl
    sx, sy, sz = fy * up[2] - fz * up[1], fz * up[0] - fx * up[2], fx * up[1] - fy * up[0]
    sl = math.sqrt(sx * sx + sy * sy + sz * sz)
    sx, sy, sz = sx / sl, sy / sl, sz / sl
    ux, uy, uz = sy * fz - sz * fy, sz * fx - sx * fz, sx * fy - sy * fx
    return [
        sx, sy, sz, -(sx * eye[0] + sy * eye[1] + sz * eye[2]),
        ux, uy, uz, -(ux * eye[0] + uy * eye[1] + uz * eye[2]),
        -fx, -fy, -fz, (fx * eye[0] + fy * eye[1] + fz * eye[2]),
        0.0, 0.0, 0.0, 1.0,
    ]


def vec_sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vec_cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def vec_normalize(v):
    l = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if l < 1e-12:
        return (0.0, 0.0, 0.0)
    return (v[0] / l, v[1] / l, v[2] / l)


def vec_dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
