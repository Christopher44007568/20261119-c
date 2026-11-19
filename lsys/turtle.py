"""3D turtle interpreting the terminal symbol stream.

The turtle always carries a *complete orthonormal frame* (heading, left and up
axes).  Rotation symbols turn that frame through Rodrigues rotations instead
of re-deriving an up-vector by parallel transport, so even an exact 180-degree
U-turn (``|``) cannot flip or degenerate the cross-section frame.  Roll
symbols (``\\`` / ``/``) twist the frame explicitly and the accumulated twist
is recorded for validation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .expander import ExpandedToken
from .parser import Grammar

Vec3 = tuple[float, float, float]


def _add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _scale(a: Vec3, factor: float) -> Vec3:
    return (a[0] * factor, a[1] * factor, a[2] * factor)


def _dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _rotate(axis: Vec3, angle: float, vector: Vec3) -> Vec3:
    """Rodrigues rotation of ``vector`` around unit ``axis`` by ``angle``."""

    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    part1 = _scale(vector, cos_a)
    part2 = _scale(_cross(axis, vector), sin_a)
    part3 = _scale(axis, _dot(axis, vector) * (1.0 - cos_a))
    return _add(_add(part1, part2), part3)


@dataclass
class FrameState:
    """Full mutable turtle state captured by ``[`` and restored by ``]``."""

    position: Vec3
    heading: Vec3       # local +Y, direction of travel
    left: Vec3          # local +X
    up: Vec3            # local +Z
    length: float
    radius: float
    roll: float         # accumulated roll in radians since branch start
    branch_id: int

    def copy(self) -> "FrameState":
        return FrameState(
            position=self.position,
            heading=self.heading,
            left=self.left,
            up=self.up,
            length=self.length,
            radius=self.radius,
            roll=self.roll,
            branch_id=self.branch_id,
        )


@dataclass
class SegmentSource:
    """Provenance of one forward segment."""

    node_id: int
    rule: str | None
    rhs_index: int
    lineage: tuple[tuple[str, int], ...]
    symbol: str


@dataclass
class Branch:
    """One continuous tube (between branch points / gaps)."""

    branch_id: int
    parent_id: int | None
    depth: int
    points: list[Vec3]
    left_frames: list[Vec3]
    up_frames: list[Vec3]
    radii: list[float]
    rolls: list[float]
    sources: list[SegmentSource]
    rule_rules: set[str] = field(default_factory=set)
    start_rule: str | None = None
    capped_gap: bool = False


@dataclass
class TurnEvent:
    """Sharp-turn diagnostic recorded for the validation stage."""

    branch_id: int
    segment_index: int
    turn_degrees: float
    position: Vec3
    node_id: int
    rule: str | None


@dataclass
class TurtleResult:
    branches: list[Branch]
    turn_events: list[TurnEvent]
    stack_high_water: int
    forward_count: int


def run_turtle(grammar: Grammar,
               tokens: list[ExpandedToken]) -> TurtleResult:
    """Interpret the terminal stream into polylines with attached frames."""

    angle = grammar.angle_radians
    branch_scale = grammar.params["branch_scale"]
    width_scale = grammar.params["width_scale"]
    length_scale = grammar.params["length_scale"]

    state = FrameState(
        position=(0.0, 0.0, 0.0),
        heading=(0.0, 1.0, 0.0),
        left=(1.0, 0.0, 0.0),
        up=(0.0, 0.0, 1.0),
        length=grammar.params["step"],
        radius=grammar.params["width"],
        roll=0.0,
        branch_id=0,
    )

    branches: list[Branch] = [_new_branch(0, None, 0, state)]
    stack: list[FrameState] = []
    turn_events: list[TurnEvent] = []
    high_water = 0
    forward_count = 0
    next_branch_id = 1
    turn_threshold = math.radians(150.0)

    def start_branch(parent: FrameState, parent_branch_id: int | None,
                     depth: int, gap: bool) -> Branch:
        nonlocal next_branch_id
        branch = _new_branch(
            next_branch_id, parent_branch_id, depth, parent
        )
        branch.capped_gap = gap
        branches.append(branch)
        parent.branch_id = next_branch_id
        next_branch_id += 1
        return branch

    for token in tokens:
        symbol = token.symbol
        current = branches[state.branch_id]

        if symbol in ("F", "G", "f"):
            if stack and state.branch_id == stack[-1].branch_id:
                # First move inside a bracket: open a child branch rooted at
                # the pushed frame so the junction shares the parent ring.
                current = start_branch(
                    state, state.branch_id, token.depth, gap=False
                )
            state.position = _add(
                state.position, _scale(state.heading, state.length)
            )
            if symbol == "f":
                # Gap move: leave the old tube untouched (it gets a tip cap)
                # and begin a fresh, separately capped tube at the new point.
                current = start_branch(
                    state, state.branch_id, token.depth, gap=True
                )
                state.roll = 0.0
                continue
            forward_count += 1
            current.points.append(state.position)
            current.left_frames.append(state.left)
            current.up_frames.append(state.up)
            current.radii.append(state.radius)
            current.rolls.append(state.roll)
            source = SegmentSource(
                node_id=token.node_id, rule=token.rule,
                rhs_index=token.rhs_index, lineage=token.lineage,
                symbol=symbol,
            )
            current.sources.append(source)
            if token.rule:
                current.rule_rules.add(token.rule)
            if current.start_rule is None:
                current.start_rule = token.rule

        elif symbol == "[":
            snapshot = state.copy()
            stack.append(snapshot)
            high_water = max(high_water, len(stack))
            # Child branches inherit a thinner radius on entry.
            state.radius *= branch_scale
            state.roll = 0.0

        elif symbol == "]":
            if not stack:
                # Parser already rejects this; guard anyway.
                raise ValueError("bracket stack underflow in turtle")
            snapshot = stack.pop()
            # The tube grown inside the brackets is a child of the branch
            # active at the matching push; restore that parent relationship.
            state = snapshot

        elif symbol == "+":
            _record_turn(turn_events, state, token, angle)
            state.heading = _rotate(state.up, angle, state.heading)
            state.left = _rotate(state.up, angle, state.left)
        elif symbol == "-":
            _record_turn(turn_events, state, token, -angle)
            state.heading = _rotate(state.up, -angle, state.heading)
            state.left = _rotate(state.up, -angle, state.left)
        elif symbol == "&":
            _record_turn(turn_events, state, token, angle)
            state.heading = _rotate(state.left, angle, state.heading)
            state.up = _rotate(state.left, angle, state.up)
        elif symbol == "^":
            _record_turn(turn_events, state, token, -angle)
            state.heading = _rotate(state.left, -angle, state.heading)
            state.up = _rotate(state.left, -angle, state.up)
        elif symbol == "\\":
            state.left = _rotate(state.heading, angle, state.left)
            state.up = _rotate(state.heading, angle, state.up)
            state.roll += angle
        elif symbol == "/":
            state.left = _rotate(state.heading, -angle, state.left)
            state.up = _rotate(state.heading, -angle, state.up)
            state.roll -= angle
        elif symbol == "|":
            _record_turn(turn_events, state, token, math.pi)
            state.heading = _rotate(state.up, math.pi, state.heading)
            state.left = _rotate(state.up, math.pi, state.left)
        elif symbol == "!":
            state.radius *= width_scale
        elif symbol == "?":
            state.length *= length_scale
        # Unknown letters without rules are intentional no-ops.

    return TurtleResult(
        branches=branches,
        turn_events=turn_events,
        stack_high_water=high_water,
        forward_count=forward_count,
    )


def _new_branch(branch_id: int, parent_id: int | None, depth: int,
                state: FrameState) -> Branch:
    return Branch(
        branch_id=branch_id,
        parent_id=parent_id,
        depth=depth,
        points=[state.position],
        left_frames=[state.left],
        up_frames=[state.up],
        radii=[state.radius],
        rolls=[state.roll],
        sources=[],
    )


def _record_turn(events: list[TurnEvent], state: FrameState,
                 token: ExpandedToken, turn_angle: float) -> None:
    """Record a near-180 heading change before the rotation is applied."""

    magnitude = abs(turn_angle)
    if magnitude < math.radians(150.0):
        return
    events.append(
        TurnEvent(
            branch_id=state.branch_id,
            segment_index=-1,
            turn_degrees=math.degrees(magnitude),
            position=state.position,
            node_id=token.node_id,
            rule=token.rule,
        )
    )
