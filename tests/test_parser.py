import math
import unittest

from lsys.errors import LSystemSyntaxError
from lsys.parser import parse_grammar

from tests.helpers import approx, raises


class ParserTests(unittest.TestCase):
    def test_parses_directives_and_rules(self):
        grammar = parse_grammar("angle 30\nwidth 0.2\naxiom A\nA -> F [+A] F\n")
        self.assertEqual(grammar.params["angle"], 30.0)
        self.assertEqual(grammar.axiom[0].symbol, "A")
        self.assertIn("A", grammar.rules)
        self.assertEqual(
            grammar.angle_radians, approx(math.radians(30.0))
        )

    def test_error_points_at_symbol_line_and_column(self):
        source = "axiom A\nA -> F [ + A F\n"
        error = raises(LSystemSyntaxError, parse_grammar, source)
        self.assertEqual(error.line, 2)
        self.assertEqual(
            source.splitlines()[1][error.column - 1], "["
        )
        self.assertIn("^", str(error))
        self.assertIn("line 2", str(error))

    def test_error_on_unknown_symbol(self):
        error = raises(
            LSystemSyntaxError, parse_grammar, "axiom A\nA -> F @ B\n"
        )
        self.assertIn("@", error.message)
        self.assertEqual(error.line, 2)

    def test_error_on_bad_lhs(self):
        error = raises(
            LSystemSyntaxError, parse_grammar, "axiom A\nab -> F\n"
        )
        self.assertEqual(error.line, 2)

    def test_directive_requires_numeric_value(self):
        error = raises(
            LSystemSyntaxError,
            parse_grammar, "angle heavy\naxiom A\nA -> F\n",
        )
        self.assertIn("numeric", error.message)

    def test_missing_axiom_rejected(self):
        raises(LSystemSyntaxError, parse_grammar, "A -> F\n")

    def test_unmatched_close_bracket_reported(self):
        error = raises(
            LSystemSyntaxError, parse_grammar, "axiom A\nA -> F ] B\n"
        )
        self.assertTrue(error.source_line.strip().startswith("A ->"))

    def test_warns_about_ruleless_letters(self):
        grammar = parse_grammar("axiom A\nA -> F Z\n")
        self.assertTrue(any("Z" in w for w in grammar.warnings))


if __name__ == "__main__":
    unittest.main()
