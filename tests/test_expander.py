import unittest

from lsys.errors import ExpansionLimitError
from lsys.expander import estimate_expansion, expand
from lsys.parser import parse_grammar

from tests.helpers import raises


def grammar(text="axiom A\nA -> F A\n"):
    return parse_grammar(text)


class ExpanderTests(unittest.TestCase):
    def test_estimate_matches_actual_expansion_length(self):
        g = grammar("axiom A\nA -> F [+A] F\n")
        for iterations in range(5):
            estimate = estimate_expansion(g, iterations)
            result = expand(g, iterations, max_symbols=10_000)
            self.assertEqual(
                estimate["total_symbols"], len(result.tokens)
            )

    def test_estimate_without_materialising_string(self):
        g = grammar("axiom A\nA -> A A\n")
        estimate = estimate_expansion(g, 30)
        self.assertEqual(estimate["total_symbols"], 2 ** 30)

    def test_iteration_limit_enforced_before_build(self):
        error = raises(
            ExpansionLimitError, expand, grammar(), 13,
            max_iterations=12,
        )
        self.assertIn("iterations", str(error))

    def test_symbol_budget_enforced(self):
        error = raises(
            ExpansionLimitError, expand,
            grammar("axiom A\nA -> A A\n"), 20,
            max_iterations=30, max_symbols=1_000,
        )
        self.assertIn("symbols", str(error))

    def test_bracket_depth_limit_enforced(self):
        error = raises(
            ExpansionLimitError, expand,
            grammar("axiom A\nA -> [A]\n"), 40,
            max_iterations=60, max_depth=10,
        )
        self.assertIn("nesting", str(error))

    def test_terminal_tokens_carry_lineage(self):
        g = grammar("axiom A\nA -> F B\nB -> G\n")
        result = expand(g, 2, max_symbols=10_000)
        symbols = [token.symbol for token in result.tokens]
        self.assertEqual(symbols, ["F", "G"])
        g_token = next(t for t in result.tokens if t.symbol == "G")
        self.assertEqual(g_token.rule, "B")
        rules = [step[0] for step in g_token.lineage]
        self.assertIn("A", rules)
        self.assertIn("B", rules)

    def test_derivation_tree_links_parents_and_children(self):
        result = expand(grammar(), 2, max_symbols=10_000)
        for node in result.tree.values():
            if node.parent_id is not None:
                self.assertIn(
                    node.node_id, result.tree[node.parent_id].children
                )

    def test_zero_iterations_returns_axiom(self):
        result = expand(grammar("axiom F A\n"), 0)
        self.assertEqual(
            [t.symbol for t in result.tokens], ["F", "A"]
        )


if __name__ == "__main__":
    unittest.main()
