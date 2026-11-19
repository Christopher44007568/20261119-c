"""Geometric diagnostics: normal flips, seam matching, section orientation."""

from __future__ import annotations

import math
from dataclasses import dataclass

from .frame import Frame, frenet_normals
from .path import Path
from .section import polygon_area
from .vector import angle_between, cross, dot, rotate, safe_normalize


@dataclass
class FlipReport:
    pt_flip_count: int
    frenet_flip_count: int
    frenet_undefined: int
    pt_max_step_deg: float

    def summary(self) -> str:
        return (
            f"parallel-transport normal flips: {self.pt_flip_count} "
            f"(max step {self.pt_max_step_deg:.2f} deg); "
            f"Frenet reference flips: {self.frenet_flip_count}, "
            f"undefined: {self.frenet_undefined}"
        )


def analyze_normal_flips(path: Path, frames: list[Frame],
                         flip_tol_deg: float = 120.0) -> FlipReport:
    """Count abrupt direction reversals along normal fields.

    A true flip appears as a ~180 degree jump between consecutive normals.
    The parallel-transport field should never flip; the Frenet reference is
    evaluated alongside it to expose the instability the design avoids.
    """
    pt_flips = 0
    max_step = 0.0
    for a, b in zip(frames, frames[1:]):
        step = math.degrees(angle_between(a.normal, b.normal))
        max_step = max(max_step, step)
        if step > flip_tol_deg:
            pt_flips += 1

    frenet = frenet_normals(path.points, path.closed)
    defined = [n for n in frenet if n is not None]
    frenet_flips = 0
    previous = None
    flip_tol_rad = math.radians(flip_tol_deg)
    for normal in frenet:
        if normal is None:
            continue
        if previous is not None and angle_between(previous, normal) > flip_tol_rad:
            frenet_flips += 1
        previous = normal
    return FlipReport(
        pt_flip_count=pt_flips,
        frenet_flip_count=frenet_flips,
        frenet_undefined=len(frenet) - len(defined),
        pt_max_step_deg=max_step,
    )


def seam_report(frames: list[Frame], closed: bool) -> dict:
    """For closed paths, quantify seam frame continuity.

    ``position_gap`` measures closure; ``normal_mismatch_deg`` compares the
    transported final normal with the initial one *expressed in the final
    frame's tangent basis*, i.e. pure twist without the (expected, geometric)
    tangent turn at a sharp corner.
    """
    if not closed:
        return {"closed": False}
    first, last = frames[0], frames[-1]
    # Mesh rings close by stitching the last ring back onto the first, so the
    # relevant closure metric is the closing edge length, not frame distance.
    closing_edge = math.sqrt(
        sum((first.position[k] - last.position[k]) ** 2 for k in range(3))
    )
    # Rotate the initial frame across the closing tangent turn only, using
    # the shared binormal as the signed rotation axis.
    turn_axis = safe_normalize(cross(last.tangent, first.tangent))
    signed_turn = angle_between(last.tangent, first.tangent)
    if turn_axis is not None:
        if dot(turn_axis, last.binormal) < 0.0:
            signed_turn = -signed_turn
        twist_normal = rotate(first.normal, last.binormal, -signed_turn)
        twist_binormal = first.binormal
    else:
        twist_normal = first.normal
        twist_binormal = first.binormal
    return {
        "closed": True,
        "closing_edge_length": closing_edge,
        "tangent_mismatch_deg": math.degrees(
            angle_between(first.tangent, last.tangent)
        ),
        "corner_turn_deg": math.degrees(
            angle_between(first.tangent, last.tangent)
        ),
        "residual_twist_normal_deg": math.degrees(
            angle_between(twist_normal, last.normal)
        ),
        "residual_twist_binormal_deg": math.degrees(
            angle_between(twist_binormal, last.binormal)
        ),
    }


def section_orientation(section) -> dict:
    """Confirm the 2D section is CCW and report its handedness in 3D.

    Mapping (u, v) -> position + u*normal + v*binormal with an outward
    stitching order requires a CCW section; a CW section would invert every
    body face normal.
    """
    area = polygon_area(list(section.points))
    return {
        "signed_area": area,
        "winding": "CCW" if area > 0 else "CW",
        "valid_for_outward_faces": area > 0.0,
    }


def scale_profile(count: int, table: dict[int, float] | None = None,
                  default: float = 1.0) -> list[float]:
    """Build per-sample scales; ``table`` maps sample index to factor."""
    scales = [default] * count
    if table:
        for index, factor in table.items():
            scales[index] = factor
    return scales


def smooth_scale_profile(count: int, anchors: list[tuple[int, float]]) -> list[float]:
    """Linearly interpolate local section scaling between anchor samples."""
    anchors = sorted(anchors)
    scales = [1.0] * count
    for segment in range(len(anchors) - 1):
        i0, v0 = anchors[segment]
        i1, v1 = anchors[segment + 1]
        for i in range(i0, min(i1, count) + 1):
            t = 0.0 if i1 == i0 else (i - i0) / (i1 - i0)
            scales[i] = v0 + (v1 - v0) * t
    first_i = anchors[0][0]
    last_i = anchors[-1][0]
    for i in range(0, min(first_i, count)):
        scales[i] = anchors[0][1]
    for i in range(min(last_i, count - 1) + 1, count):
        scales[i] = anchors[-1][1]
    return scales


def frame_dot_chain(frames: list[Frame]) -> list[float]:
    """Consecutive normal dot products; values near -1 signal a flip."""
    return [dot(a.normal, b.normal) for a, b in zip(frames, frames[1:])]
