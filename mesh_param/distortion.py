"""Per-triangle quality metrics of a parameterization.

Reports flipped triangles (negative signed UV area), angle distortion
(conformal error) and area distortion relative to the 3D surface.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .mesh import Mesh


@dataclass
class DistortionReport:
    flipped: np.ndarray  # (m,) bool, True where the UV triangle is flipped
    signed_uv_area: np.ndarray  # (m,) float
    angle_distortion: np.ndarray  # (m,) float, RMS angle error in degrees
    area_distortion: np.ndarray  # (m,) float, log2(uv_area / 3d_area), normalized

    def summary(self) -> str:
        m = len(self.flipped)
        lines = [
            f"triangles:            {m}",
            f"flipped triangles:    {int(self.flipped.sum())}"
            + (f"  (indices: {np.flatnonzero(self.flipped)[:20].tolist()}"
               + (" ..." if self.flipped.sum() > 20 else "") + ")"
               if self.flipped.any() else ""),
            f"angle distortion:     mean {self.angle_distortion.mean():.3f} deg, "
            f"max {self.angle_distortion.max():.3f} deg (RMS angle error)",
            f"area distortion:      mean |log2 ratio| "
            f"{np.abs(self.area_distortion).mean():.3f}, "
            f"max {np.abs(self.area_distortion).max():.3f}",
        ]
        return "\n".join(lines)


def _triangle_angles(p0, p1, p2):
    def angle_at(a, b, c):
        v1, v2 = a - b, c - b
        n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
        if n1 < 1e-14 or n2 < 1e-14:
            return 0.0
        cos = np.clip(np.dot(v1, v2) / (n1 * n2), -1.0, 1.0)
        return np.arccos(cos)

    return np.array([angle_at(p1, p0, p2), angle_at(p0, p1, p2),
                     angle_at(p0, p2, p1)])


def distortion_report(mesh: Mesh) -> DistortionReport:
    if mesh.uvs is None:
        raise ValueError("mesh has no UVs; run parameterize() first")
    v3 = mesh.vertices
    uv = mesh.uvs
    m = len(mesh.faces)
    flipped = np.zeros(m, dtype=bool)
    signed_area = np.zeros(m)
    angle_dist = np.zeros(m)
    area_dist = np.zeros(m)

    area3_total = 0.0
    area2_total = 0.0
    areas3 = np.zeros(m)
    areas2 = np.zeros(m)
    for fi, (a, b, c) in enumerate(mesh.faces):
        p0, p1, p2 = v3[[a, b, c]]
        q0, q1, q2 = uv[[a, b, c]]
        d1, d2 = q1 - q0, q2 - q0
        sa = 0.5 * (d1[0] * d2[1] - d1[1] * d2[0])
        signed_area[fi] = sa
        flipped[fi] = sa < 0.0
        a3 = 0.5 * np.linalg.norm(np.cross(p1 - p0, p2 - p0))
        areas3[fi] = a3
        areas2[fi] = abs(sa)
        area3_total += a3
        area2_total += abs(sa)

        ang3 = _triangle_angles(p0, p1, p2)
        ang2 = _triangle_angles(q0, q1, q2)
        diff = np.degrees(ang3 - ang2)
        angle_dist[fi] = np.sqrt(np.mean(diff ** 2))

    scale = area2_total / area3_total if area3_total > 0 else 1.0
    for fi in range(m):
        if areas3[fi] > 1e-14 and areas2[fi] > 1e-14:
            area_dist[fi] = np.log2(areas2[fi] / (areas3[fi] * scale))
        else:
            area_dist[fi] = 0.0

    return DistortionReport(
        flipped=flipped,
        signed_uv_area=signed_area,
        angle_distortion=angle_dist,
        area_distortion=area_dist,
    )
