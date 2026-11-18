"""Pinhole camera producing normalized ray directions per pixel."""
from . import vecmath as vm


class Camera:
    def __init__(self, eye, target, up=(0.0, 1.0, 0.0), fov_y_deg=45.0):
        self.eye = tuple(eye)
        forward = vm.norm(vm.sub(target, eye))
        right = vm.norm(vm.cross(forward, up))
        true_up = vm.cross(right, forward)
        import math
        half_h = math.tan(math.radians(fov_y_deg) * 0.5)
        self._forward = forward
        self._right = right
        self._up = true_up
        self._half_h = half_h
        self._aspect = 1.0

    def ray(self, u, v):
        """u, v in [-1, 1]; v=1 is the top of the frame."""
        direction = vm.add(
            self._forward,
            vm.add(vm.mul(self._right, u * self._half_h * self._aspect),
                   vm.mul(self._up, v * self._half_h)))
        return self.eye, vm.norm(direction)

    def set_aspect(self, aspect):
        self._aspect = aspect
