"""Scene graph: objects keep current AND previous-frame model matrices."""

from .math3d import (
    mat_identity,
    mat_inverse,
    mat_look_at,
    mat_mul,
    mat_perspective,
)


class Object3D:
    """A renderable object that retains its previous-frame model matrix.

    `model`      : model matrix for the current frame
    `prev_model` : model matrix used last frame (for velocity computation)
    `dynamic`    : static objects never write object velocity
    """

    def __init__(self, name, triangles, color, dynamic=True):
        self.name = name
        self.triangles = triangles
        self.color = color  # (r, g, b) in 0..1
        self.dynamic = dynamic
        self.model = mat_identity()
        self.prev_model = mat_identity()
        self.inv_model = mat_identity()

    def update(self, model):
        """Advance to a new frame: shift current matrix into history."""
        self.prev_model = self.model
        self.model = model
        self.inv_model = mat_inverse(model)


class Camera:
    """Camera retaining current and previous view-projection matrices."""

    def __init__(self, fov_y_rad, aspect, near, far):
        self.proj = mat_perspective(fov_y_rad, aspect, near, far)
        self.view = mat_identity()
        self.prev_view = mat_identity()
        self.view_proj = mat_identity()
        self.prev_view_proj = mat_identity()
        self.inv_view_proj = mat_identity()

    def update(self, eye, target, up=(0.0, 1.0, 0.0)):
        self.prev_view = self.view
        self.prev_view_proj = self.view_proj
        self.view = mat_look_at(eye, target, up)
        self.view_proj = mat_mul(self.proj, self.view)
        self.inv_view_proj = mat_inverse(self.view_proj)


class FrameHistory:
    """Per-frame history used to reconstruct motion vectors.

    Stores previous-frame depth, view-projection and per-object model
    matrices, plus the frame time so velocities can be expressed per
    second and scaled by the shutter exposure time.
    """

    def __init__(self):
        self.prev_depth = None
        self.dt = 1.0 / 60.0
        self.frame_index = -1

    def advance(self, depth, dt):
        self.prev_depth = depth
        self.dt = dt
        self.frame_index += 1
