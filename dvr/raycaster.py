"""Vectorized direct volume ray caster with front-to-back alpha compositing.

Features: axis-aligned clipping box, configurable sampling step with
Beer-Lambert opacity correction, transfer-function LUT mapping, and
empty-space skipping (ESS) over a coarse block grid. No surface mesh is
ever extracted; compositing integrates the volume integral directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .transfer import TransferFunction
from .volume import Volume

EARLY_RAY_TERMINATION = 0.005  # transmittance below this -> ray is done


@dataclass
class RenderResult:
    image: np.ndarray            # (h, w, 3) float64 in [0, 1]
    transmittance: np.ndarray    # (h, w) remaining T per pixel
    samples_per_ray: np.ndarray  # (h, w) int64, actual density samples taken

    @property
    def total_samples(self) -> int:
        return int(self.samples_per_ray.sum())


@dataclass
class Camera:
    """Pinhole camera looking at the unit cube."""

    position: np.ndarray = field(default_factory=lambda: np.array([0.5, 0.5, 2.5]))
    look_at: np.ndarray = field(default_factory=lambda: np.array([0.5, 0.5, 0.5]))
    up: np.ndarray = field(default_factory=lambda: np.array([0.0, 1.0, 0.0]))
    fov_y_deg: float = 40.0

    def rays(self, width, height):
        fwd = self.look_at - self.position
        fwd /= np.linalg.norm(fwd)
        right = np.cross(fwd, self.up)
        right /= np.linalg.norm(right)
        up = np.cross(right, fwd)
        tan_half = np.tan(np.radians(self.fov_y_deg) / 2.0)
        aspect = width / height
        us = (np.arange(width) + 0.5) / width * 2.0 - 1.0
        vs = 1.0 - (np.arange(height) + 0.5) / height * 2.0
        uu, vv = np.meshgrid(us * aspect * tan_half, vs * tan_half)
        dirs = fwd[None, None, :] + uu[..., None] * right[None, None, :] + vv[..., None] * up[None, None, :]
        dirs /= np.linalg.norm(dirs, axis=-1, keepdims=True)
        origins = np.broadcast_to(self.position, dirs.shape)
        return origins.astype(np.float64), dirs.astype(np.float64)


def _intersect_aabb(origins, dirs, box_min, box_max):
    """Slab test; returns (t_enter, t_exit) with t_enter < t_exit for hits."""
    eps = 1e-12
    t_near = np.full(dirs.shape[:-1], -np.inf)
    t_far = np.full(dirs.shape[:-1], np.inf)
    for axis in range(3):
        d = dirs[..., axis]
        o = origins[..., axis]
        inv = np.where(np.abs(d) < eps, np.inf * np.sign(d + eps), 1.0 / d)
        t0 = (box_min[axis] - o) * inv
        t1 = (box_max[axis] - o) * inv
        t_near = np.maximum(t_near, np.minimum(t0, t1))
        t_far = np.minimum(t_far, np.maximum(t0, t1))
    t_enter = np.maximum(t_near, 0.0)
    return t_enter, t_far


class RayCaster:
    def __init__(
        self,
        volume: Volume,
        transfer: TransferFunction,
        clip_min=(0.0, 0.0, 0.0),
        clip_max=(1.0, 1.0, 1.0),
        step=None,
        background=(0.05, 0.05, 0.08),
        ess_enabled: bool = False,
        ess_block: int = 8,
        early_term: float = EARLY_RAY_TERMINATION,
    ):
        self.volume = volume
        self.transfer = transfer
        self.clip_min = np.asarray(clip_min, dtype=np.float64)
        self.clip_max = np.asarray(clip_max, dtype=np.float64)
        self.step = float(step) if step else volume.voxel_size
        self.background = np.asarray(background, dtype=np.float64)
        self.ess_enabled = ess_enabled
        self.ess_block = int(ess_block)
        self.early_term = float(early_term)
        self._block_empty = None
        if ess_enabled:
            self.build_ess_grid()

    def build_ess_grid(self):
        """Conservative block grid: a block is empty iff every voxel in it
        maps to (numerically) zero alpha under the current transfer function."""
        lut_alpha = self.transfer.lut[:, 3]
        nonzero = np.nonzero(lut_alpha > 1e-6)[0]
        min_visible_idx = int(nonzero[0]) if nonzero.size else None
        b = self.ess_block
        nz, ny, nx = self.volume.shape
        empty = np.zeros(((nz + b - 1) // b, (ny + b - 1) // b, (nx + b - 1) // b), dtype=bool)
        data = self.volume.data
        for iz in range(0, nz, b):
            for iy in range(0, ny, b):
                for ix in range(0, nx, b):
                    # dilate by one voxel: trilinear sampling inside the block
                    # may read voxels just across the boundary
                    block = data[
                        max(iz - 1, 0) : iz + b + 1,
                        max(iy - 1, 0) : iy + b + 1,
                        max(ix - 1, 0) : ix + b + 1,
                    ]
                    bmax = float(block.max()) if block.size else 0.0
                    if min_visible_idx is None or bmax * 255.0 < min_visible_idx:
                        empty[iz // b, iy // b, ix // b] = True
        self._block_empty = empty

    def render(self, width, height, camera=None) -> RenderResult:
        camera = camera or Camera()
        origins, dirs = camera.rays(width, height)
        t_enter, t_exit = _intersect_aabb(origins, dirs, self.clip_min, self.clip_max)
        hit = t_enter < t_exit

        flat_origins = origins.reshape(-1, 3)
        flat_dirs = dirs.reshape(-1, 3)
        t = (t_enter.reshape(-1) + 0.5 * self.step).copy()
        t_end = t_exit.reshape(-1)
        active = hit.reshape(-1).copy()

        acc = np.zeros((width * height, 3), dtype=np.float64)
        trans = np.ones(width * height, dtype=np.float64)
        counts = np.zeros(width * height, dtype=np.int64)

        lut = self.transfer.lut
        alpha_lut = self.transfer.corrected_alpha(lut[:, 3], self.step)
        color_lut = lut[:, :3]
        data = self.volume.data
        nz, ny, nx = self.volume.shape

        while active.any():
            idx = np.nonzero(active)[0]
            ti = t[idx]
            pos = flat_origins[idx] + ti[:, None] * flat_dirs[idx]

            if self.ess_enabled:
                ti = self._skip_empty(pos, flat_dirs[idx], ti, t_end[idx], t_enter.reshape(-1)[idx])
                t[idx] = ti
                still = ti < t_end[idx]
                if not still.all():
                    active[idx[~still]] = False
                    idx = idx[still]
                    pos = pos[still]
                if idx.size == 0:
                    continue

            density = self._sample(pos, data, nz, ny, nx)
            lut_idx = np.clip((density * 255.0).astype(np.intp), 0, 255)
            a = alpha_lut[lut_idx]
            c = color_lut[lut_idx]
            w = trans[idx] * a
            acc[idx] += w[:, None] * c
            trans[idx] *= 1.0 - a
            counts[idx] += 1
            t[idx] += self.step
            active[idx] = (t[idx] < t_end[idx]) & (trans[idx] > self.early_term)

        img = acc + trans[:, None] * self.background[None, :]
        return RenderResult(
            image=img.reshape(height, width, 3),
            transmittance=trans.reshape(height, width),
            samples_per_ray=counts.reshape(height, width),
        )

    @staticmethod
    def _sample(pos, data, nz, ny, nx):
        """Trilinear interpolation; pos in [0, 1]^3 world coordinates."""
        gx = np.clip(pos[:, 0] * nx - 0.5, 0.0, nx - 1.0)
        gy = np.clip(pos[:, 1] * ny - 0.5, 0.0, ny - 1.0)
        gz = np.clip(pos[:, 2] * nz - 0.5, 0.0, nz - 1.0)
        x0 = np.minimum(gx.astype(np.intp), nx - 2)
        y0 = np.minimum(gy.astype(np.intp), ny - 2)
        z0 = np.minimum(gz.astype(np.intp), nz - 2)
        fx = gx - x0
        fy = gy - y0
        fz = gz - z0
        c00 = data[z0, y0, x0] + (data[z0, y0, x0 + 1] - data[z0, y0, x0]) * fx
        c01 = data[z0, y0 + 1, x0] + (data[z0, y0 + 1, x0 + 1] - data[z0, y0 + 1, x0]) * fx
        c10 = data[z0 + 1, y0, x0] + (data[z0 + 1, y0, x0 + 1] - data[z0 + 1, y0, x0]) * fx
        c11 = data[z0 + 1, y0 + 1, x0] + (data[z0 + 1, y0 + 1, x0 + 1] - data[z0 + 1, y0 + 1, x0]) * fx
        c0 = c00 + (c01 - c00) * fy
        c1 = c10 + (c11 - c10) * fy
        return c0 + (c1 - c0) * fz

    def _skip_empty(self, pos, dirs, t, t_end, t_base):
        """Advance t past any empty ESS block containing the current position."""
        b = self.ess_block
        nz, ny, nx = self.volume.shape
        empty = self._block_empty
        vx = np.clip((pos[:, 0] * nx).astype(np.intp), 0, nx - 1)
        vy = np.clip((pos[:, 1] * ny).astype(np.intp), 0, ny - 1)
        vz = np.clip((pos[:, 2] * nz).astype(np.intp), 0, nz - 1)
        in_empty = empty[vz // b, vy // b, vx // b]
        if not in_empty.any():
            return t
        idx = np.nonzero(in_empty)[0]
        lo = np.stack([(vx[idx] // b * b) / nx, (vy[idx] // b * b) / ny, (vz[idx] // b * b) / nz], axis=1)
        hi = np.stack([(vx[idx] // b * b + b) / nx, (vy[idx] // b * b + b) / ny, (vz[idx] // b * b + b) / nz], axis=1)
        o = pos[idx]
        d = dirs[idx]
        eps = 1e-12
        t_far = np.full(idx.shape, np.inf)
        for axis in range(3):
            da = d[:, axis]
            inv = np.where(np.abs(da) < eps, np.inf * np.sign(da + eps), 1.0 / da)
            t0 = (lo[:, axis] - o[:, axis]) * inv
            t1 = (hi[:, axis] - o[:, axis]) * inv
            t_far = np.minimum(t_far, np.maximum(t0, t1))
        t_new = t.copy()
        t_jump = t[idx] + np.maximum(t_far, 0.0)
        # snap back onto the regular sampling lattice so results match non-ESS
        k = np.ceil((t_jump - t_base[idx]) / self.step - 0.5)
        t_snap = t_base[idx] + (k + 0.5) * self.step
        t_new[idx] = np.minimum(np.maximum(t_snap, t[idx] + self.step), t_end[idx])
        return t_new
