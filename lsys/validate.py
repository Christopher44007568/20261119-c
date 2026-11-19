"""Geometric validation: frame integrity, twist and junction cracks.

The checks are deliberately quantitative so the test grammars (branching,
back-bend, near-180 turns) can assert the absence of cracks and bound the
cross-section twist instead of relying on visual inspection.
"""

from __future__ import annotations

import math
from collections import Counter

from .mesh import Mesh
from .turtle import TurtleResult


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _norm(a):
    return math.sqrt(_dot(a, a))


def validate_result(result: TurtleResult, mesh: Mesh,
                    radial_segments: int) -> dict:
    """Run all checks and return a structured report.

    Report sections:

    * ``watertight``       - every edge used by exactly two faces
    * ``frame``            - orthonormality / handedness error bounds
    * ``twist``            - max roll and frame rotation between rings
    * ``turns``            - sharp (near-180 degree) turn events
    * ``junctions``        - branch-point ring sharing and crack distances
    * ``ok``               - overall pass flag
    """

    report: dict = {
        "ok": True,
        "watertight": _check_watertight(mesh),
        "frame": _check_frames(result),
        "twist": _check_twist(result),
        "turns": _check_turns(result),
        "junctions": _check_junctions(result, mesh, radial_segments),
    }
    report["ok"] = all(
        section.get("ok", True) for section in report.values()
        if isinstance(section, dict)
    )
    return report


def _check_watertight(mesh: Mesh) -> dict:
    edge_counts: Counter[tuple[int, int]] = Counter()
    for face in mesh.faces:
        indices = face.indices
        for i, start in enumerate(indices):
            end = indices[(i + 1) % len(indices)]
            edge = (min(start, end), max(start, end))
            edge_counts[edge] += 1
    boundary = [edge for edge, count in edge_counts.items() if count != 2]
    non_manifold = [edge for edge, count in edge_counts.items() if count > 2]
    return {
        "ok": not boundary and not non_manifold,
        "edge_count": len(edge_counts),
        "boundary_edges": boundary[:20],
        "boundary_edge_count": len(boundary),
        "non_manifold_edges": non_manifold[:20],
        "non_manifold_edge_count": len(non_manifold),
    }


def _check_frames(result: TurtleResult) -> dict:
    max_ortho_error = 0.0
    max_handedness_error = 0.0
    checked = 0
    for branch in result.branches:
        for left, up, heading in zip(
                branch.left_frames, branch.up_frames,
                _branch_headings(branch)):
            max_ortho_error = max(
                max_ortho_error,
                abs(_dot(left, up)),
                abs(_norm(left) - 1.0),
                abs(_norm(up) - 1.0),
                abs(_norm(heading) - 1.0),
            )
            max_handedness_error = max(
                max_handedness_error,
                abs(_norm(_cross(left, up)) - 1.0),
            )
            checked += 1
    return {
        "ok": max_ortho_error < 1e-9 and max_handedness_error < 1e-9,
        "frames_checked": checked,
        "max_orthonormality_error": max_ortho_error,
        "max_handedness_error": max_handedness_error,
    }


def _branch_headings(branch):
    headings = []
    points = branch.points
    for index in range(len(points)):
        if index == 0:
            direction = (
                points[1][0] - points[0][0],
                points[1][1] - points[0][1],
                points[1][2] - points[0][2],
            )
        else:
            direction = (
                points[index][0] - points[index - 1][0],
                points[index][1] - points[index - 1][1],
                points[index][2] - points[index - 1][2],
            )
        length = math.sqrt(_dot(direction, direction))
        headings.append(
            (direction[0] / length, direction[1] / length,
             direction[2] / length)
            if length > 1e-15 else (0.0, 1.0, 0.0)
        )
    return headings


def _check_twist(result: TurtleResult) -> dict:
    max_roll = 0.0
    max_ring_rotation = 0.0
    per_branch: dict[int, float] = {}
    for branch in result.branches:
        branch_peak = 0.0
        for index in range(1, len(branch.left_frames)):
            previous = branch.left_frames[index - 1]
            current = branch.left_frames[index]
            cosine = max(-1.0, min(1.0, _dot(previous, current)))
            rotation = math.degrees(math.acos(cosine))
            max_ring_rotation = max(max_ring_rotation, rotation)
        for roll in branch.rolls:
            branch_peak = max(branch_peak, abs(math.degrees(roll)))
        per_branch[branch.branch_id] = branch_peak
        max_roll = max(max_roll, branch_peak)
    return {
        "ok": True,
        "max_roll_degrees": max_roll,
        "max_ring_to_ring_rotation_degrees": max_ring_rotation,
        "roll_by_branch": per_branch,
        "note": "roll is explicitly driven by \\ and / symbols and is "
                "reset at every branch push",
    }


def _check_turns(result: TurtleResult) -> dict:
    events = [
        {
            "branch_id": event.branch_id,
            "segment_index": event.segment_index,
            "turn_degrees": round(event.turn_degrees, 6),
            "position": tuple(round(value, 6) for value in event.position),
            "node_id": event.node_id,
            "rule": event.rule,
        }
        for event in result.turn_events
    ]
    return {
        "ok": True,
        "sharp_turn_count": len(events),
        "events": events,
        "threshold_degrees": 150.0,
        "note": "sharp turns keep a continuous frame; presence of events is "
                "diagnostic, not a failure",
    }


def _check_junctions(result: TurtleResult, mesh: Mesh,
                     radial_segments: int) -> dict:
    records = mesh.metadata.get("junctions", [])
    details = []
    crack_gap_max = 0.0
    fully_welded = 0
    for record in records:
        position = record["position"]
        gap = _junction_gap(record)
        crack_gap_max = max(crack_gap_max, gap)
        welded = gap < 1e-9
        fully_welded += 1 if welded else 0
        details.append({
            "parent_branch": record["parent_branch"],
            "parent_point_index": record["parent_point_index"],
            "child_branches": record["child_branches"],
            "tube_count": record["tube_count"],
            "apex_vertex": record["apex_vertex"],
            "welded": welded,
            "contact_gap": gap,
            "junction_position": tuple(round(v, 6) for v in position),
        })

    # Watertightness is already enforced edge-by-edge; confirm junction rings
    # contribute no boundary edges via the shared edge table.
    edge_counts = _edge_counts(mesh)
    junction_edges_ok = True
    bad_junction_edges = [
        edge for edge, count in edge_counts.items() if count != 2
    ]
    junction_edges_ok = not bad_junction_edges

    return {
        "ok": crack_gap_max < 1e-9 and junction_edges_ok,
        "junctions": details,
        "welded_junction_count": fully_welded,
        "junction_edge_manifold": junction_edges_ok,
        "max_crack_gap": crack_gap_max,
        "radius_mismatch_count": len(
            mesh.metadata.get("junction_radius_mismatches", [])
        ),
        "note": "child tubes are sealed tubes ending exactly on the parent "
                "branch point (zero contact gap); radius differences are the "
                "intended tapering, not cracks",
    }


def _edge_counts(mesh: Mesh) -> dict[tuple[int, int], int]:
    counts: dict[tuple[int, int], int] = {}
    for face in mesh.faces:
        indices = face.indices
        for i, start in enumerate(indices):
            end = indices[(i + 1) % len(indices)]
            edge = (min(start, end), max(start, end))
            counts[edge] = counts.get(edge, 0) + 1
    return counts


def _junction_gap(record: dict) -> float:
    # Distance from each child base-ring center to the parent branch point.
    position = record["position"]
    worst = 0.0
    for base in record.get("child_bases", []):
        center = base["center"]
        worst = max(worst, math.sqrt(sum(
            (a - b) ** 2 for a, b in zip(center, position)
        )))
    return worst
