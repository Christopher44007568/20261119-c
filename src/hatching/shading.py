"""Tone-driven hatching layers from a fixed object-space light.

The light is defined in object space, so tone is invariant under camera
rotation: rotating the view never moves which surface region carries which
line density, which is what keeps the hatching attached to the surface.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

LIGHT = np.array([0.4, 0.5, 0.75])
LIGHT = LIGHT / np.linalg.norm(LIGHT)


@dataclass(frozen=True)
class HatchLayer:
    index: int
    tone_min: float       # layer active where tone in [tone_min, tone_max)
    tone_max: float
    spacing: float        # object-space seed spacing

    def active(self, tone: np.ndarray) -> np.ndarray:
        return (tone >= self.tone_min) & (tone < self.tone_max)


# Darker bands get denser lines (smaller spacing), expressing shading purely
# through line density in object space.
LAYERS = (
    HatchLayer(0, 0.10, 0.35, 0.13),
    HatchLayer(1, 0.35, 0.60, 0.095),
    HatchLayer(2, 0.60, 1.01, 0.07),
)


def vertex_tone(mesh, light: np.ndarray = LIGHT) -> np.ndarray:
    """Diffuse shading tone in [0, 1] from the fixed object-space light.

    Two-sided diffuse (absolute dot product) keeps open sheets and planes
    shaded on both faces instead of collapsing back-facing regions to black.
    """
    diffuse = np.clip(np.abs(mesh.normals @ light), 0.0, 1.0)
    return 1.0 - diffuse


def face_tone(mesh, tone_v: np.ndarray) -> np.ndarray:
    return tone_v[mesh.faces].mean(axis=1)


def interp_vertex(mesh, values: np.ndarray, face_id: int,
                  bary: np.ndarray) -> float:
    return float(bary @ values[mesh.faces[face_id]])


def stratified_surface_samples(mesh, spacing: float, rng, extra_margin=1.3):
    """One approximately stratified sample per area cell of side ~spacing.

    Returns (points (M,3), face_ids (M,)) sampled by rejection inside
    randomly shifted face-barycentric grid cells, giving near-uniform
    object-space seed density without any screen-space projection.
    """
    # Oversample each face proportionally to its area, then apply area-based
    # rejection so surviving points have uniform object-space density (one
    # per spacing^2 of surface area in expectation).
    target_area = spacing * spacing
    lam = extra_margin * mesh.face_areas / target_area
    counts = np.maximum(1, np.ceil(lam).astype(int))
    face_ids = np.repeat(np.arange(mesh.n_faces), counts)
    u = rng.random(len(face_ids))
    v = rng.random(len(face_ids))
    flip = u + v > 1.0
    u[flip] = 1.0 - u[flip]
    v[flip] = 1.0 - v[flip]
    l0 = 1.0 - u - v
    accept_prob = lam[face_ids] / counts[face_ids]
    keep = rng.random(len(face_ids)) < accept_prob
    face_ids, u, v, l0 = face_ids[keep], u[keep], v[keep], l0[keep]
    tri = mesh.vertices[mesh.faces[face_ids]]
    points = (l0[:, None] * tri[:, 0] + u[:, None] * tri[:, 1]
              + v[:, None] * tri[:, 2])
    bary = np.column_stack([l0, u, v])
    return points, face_ids, bary
