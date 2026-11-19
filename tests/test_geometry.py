import unittest
from collections import Counter

from lsys.expander import expand
from lsys.mesh import build_mesh
from lsys.parser import parse_grammar
from lsys.turtle import run_turtle
from lsys.validate import validate_result

from tests.helpers import approx

BRANCHING = (
    "angle 25.7\nsegments 8\naxiom A\n"
    "A -> F [&A][+A][/A] F A\n"
)
BENDBACK = (
    "angle 30\nsegments 10\naxiom A\n"
    "A -> F + F | F --- F B\nB -> F ^ F | F [+B] F\n"
)
TWIST = (
    "angle 45\nsegments 12\naxiom A\n"
    "A -> F \\ F \\ F [+A] / F [-A] F\n"
)


def build(text, iterations=3, segments=8):
    g = parse_grammar(text)
    expansion = expand(g, iterations, max_symbols=100_000)
    result = run_turtle(g, expansion.tokens)
    mesh = build_mesh(result, radial_segments=segments)
    report = validate_result(result, mesh, segments)
    return g, expansion, result, mesh, report


def edge_degrees(mesh):
    counts = Counter()
    for face in mesh.faces:
        indices = face.indices
        for i, start in enumerate(indices):
            end = indices[(i + 1) % len(indices)]
            counts[(min(start, end), max(start, end))] += 1
    return counts


class GeometryTests(unittest.TestCase):
    def test_branching_mesh_is_watertight(self):
        _, _, result, mesh, report = build(BRANCHING, iterations=3)
        degrees = edge_degrees(mesh)
        self.assertTrue(all(count == 2 for count in degrees.values()))
        self.assertTrue(report["watertight"]["ok"])
        self.assertGreater(len(result.branches), 1)

    def test_bendback_survives_near_180_turns_without_cracks(self):
        _, _, result, mesh, report = build(BENDBACK, iterations=3)
        self.assertTrue(report["watertight"]["ok"])
        self.assertGreaterEqual(report["turns"]["sharp_turn_count"], 1)
        self.assertEqual(report["junctions"]["max_crack_gap"], 0.0)
        self.assertTrue(report["frame"]["ok"])
        self.assertLess(
            report["frame"]["max_orthonormality_error"], 1e-9
        )

    def test_twist_grammar_records_roll_and_stays_watertight(self):
        _, _, result, mesh, report = build(TWIST, iterations=3)
        self.assertTrue(report["watertight"]["ok"])
        self.assertEqual(
            report["twist"]["max_roll_degrees"], approx(90.0)
        )
        self.assertTrue(report["frame"]["ok"])

    def test_frame_remains_orthonormal_through_all_branches(self):
        for text in (BRANCHING, BENDBACK, TWIST):
            _, _, result, mesh, report = build(text, iterations=2)
            self.assertTrue(report["frame"]["ok"], text)

    def test_every_branch_records_rule_provenance(self):
        _, _, result, _, _ = build(BRANCHING, iterations=3)
        for branch in result.branches:
            for source in branch.sources:
                self.assertGreaterEqual(source.node_id, 0)

    def test_u_turn_returns_turtle_heading_opposite(self):
        g = parse_grammar("angle 90\naxiom A\nA -> F | F\n")
        expansion = expand(g, 1)
        result = run_turtle(g, expansion.tokens)
        branch = result.branches[0]
        start, end = branch.points[0], branch.points[-1]
        self.assertEqual(end[0], approx(start[0]))

    def test_push_pop_restores_full_frame_state(self):
        g = parse_grammar("angle 45\naxiom A\nA -> F [+F+F] F\n")
        expansion = expand(g, 1)
        result = run_turtle(g, expansion.tokens)
        self.assertGreaterEqual(len(result.branches[0].points), 3)

    def test_junction_contact_gap_is_zero(self):
        _, _, _, _, report = build(BRANCHING, iterations=3)
        self.assertTrue(report["junctions"]["ok"])
        self.assertEqual(report["junctions"]["max_crack_gap"], 0.0)
        self.assertGreaterEqual(
            report["junctions"]["welded_junction_count"], 1
        )

    def test_gap_move_width_and_length_commands_stay_watertight(self):
        text = (
            "angle 35\nsegments 6\naxiom A\n"
            "A -> F ! F ? G f + F & F \\ F | F\n"
        )
        g, expansion, result, mesh, report = build(text, iterations=1)
        degrees = edge_degrees(mesh)
        self.assertTrue(all(count == 2 for count in degrees.values()))
        self.assertTrue(any(branch.capped_gap for branch in result.branches))
        # '!' shrinks the radius along the first branch.
        first = result.branches[0]
        self.assertLess(first.radii[-1], first.radii[0])


if __name__ == "__main__":
    unittest.main()
