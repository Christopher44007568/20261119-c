"""Signed-distance primitives, smooth blending and the demo scene."""
import math

from . import vecmath as vm


def sd_sphere(p, radius):
    return vm.length(p) - radius


def sd_box(p, half_extents):
    """Box SDF; half_extents is a tuple of half sizes along x, y, z."""
    qx = abs(p[0]) - half_extents[0]
    qy = abs(p[1]) - half_extents[1]
    qz = abs(p[2]) - half_extents[2]
    outside = math.sqrt(max(qx, 0.0) ** 2
                        + max(qy, 0.0) ** 2
                        + max(qz, 0.0) ** 2)
    inside = min(max(qx, qy, qz), 0.0)
    return outside + inside


def sd_torus(p, major_radius, minor_radius):
    """Torus lying in the local xy-plane."""
    qx = math.sqrt(p[0] * p[0] + p[1] * p[1]) - major_radius
    return math.sqrt(qx * qx + p[2] * p[2]) - minor_radius


def smooth_min(a, b, k):
    """Polynomial smooth minimum. k > 0 is the blend (connection) radius."""
    if k <= 0.0:
        return min(a, b)
    h = vm.clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return vm.slerp(b, a, h) - k * h * (1.0 - h)


def smooth_min_id(a, b, k, id_a=0, id_b=1):
    """Smooth minimum that also returns the id of the dominant primitive."""
    if k <= 0.0:
        return (a, id_a) if a <= b else (b, id_b)
    h = vm.clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    d = vm.slerp(b, a, h) - k * h * (1.0 - h)
    return (d, id_a if h >= 0.5 else id_b)


class Scene:
    """Torus + box joined by a smooth union inside a rotated local frame.

    The local frame is rotated by Euler angles (ax, ay, az) and offset by
    `center`; `blend_radius` controls how wide the smooth connection is.
    An analytic validation sphere surrounds the whole composite.
    """

    TORUS = 0
    BOX = 1

    def __init__(self, center=(0.0, 0.0, 0.0),
                 euler=(0.0, 0.0, 0.0), blend_radius=0.35,
                 torus_major=0.85, torus_minor=0.30,
                 box_half=(0.55, 0.40, 0.40),
                 sphere_radius=1.75):
        self.center = center
        self.euler = euler
        self.blend_radius = blend_radius
        self.torus_major = torus_major
        self.torus_minor = torus_minor
        self.box_half = box_half
        self.sphere_radius = sphere_radius
        self._rotation = vm.rot_matrix(euler[0], euler[1], euler[2])

    def to_local(self, p):
        shifted = vm.sub(p, self.center)
        return vm.mat_vec(self._rotation, shifted)

    def eval_id(self, p):
        """Return (signed distance, dominant primitive id) in world space."""
        local = self.to_local(p)
        d_torus = sd_torus(local, self.torus_major, self.torus_minor)
        d_box = sd_box(local, self.box_half)
        return smooth_min_id(d_torus, d_box, self.blend_radius,
                             self.TORUS, self.BOX)

    def __call__(self, p):
        return self.eval_id(p)[0]
