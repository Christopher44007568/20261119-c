import json
import os
import tempfile
import unittest

from lsys.cli import main
from lsys.expander import expand
from lsys.export import (
    write_derivation_dot,
    write_derivation_json,
    write_manifest,
    write_svg,
)
from lsys.mesh import build_mesh
from lsys.parser import parse_grammar
from lsys.turtle import run_turtle
from lsys.validate import validate_result

GRAMMAR = (
    "angle 25\nsegments 6\naxiom A\nA -> F [+A] F A\n"
)


class ExportCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.grammar_path = os.path.join(self.tmp, "tree.lsys")
        with open(self.grammar_path, "w", encoding="utf-8") as handle:
            handle.write(GRAMMAR)

    def _pipeline(self):
        g = parse_grammar(GRAMMAR)
        expansion = expand(g, 2, max_symbols=100_000)
        result = run_turtle(g, expansion.tokens)
        mesh = build_mesh(result, radial_segments=6)
        report = validate_result(result, mesh, 6)
        return g, expansion, result, mesh, report

    def test_derivation_json_and_dot_written(self):
        _, expansion, _, _, _ = self._pipeline()
        json_path = os.path.join(self.tmp, "tree.json")
        dot_path = os.path.join(self.tmp, "tree.dot")
        write_derivation_json(expansion, json_path)
        write_derivation_dot(expansion, dot_path)
        payload = json.load(open(json_path, encoding="utf-8"))
        self.assertIn("nodes", payload)
        self.assertIn("terminals", payload)
        self.assertTrue(open(dot_path, encoding="utf-8").read().startswith(
            "digraph"
        ))

    def test_manifest_lists_branch_rule_sources(self):
        g, expansion, result, mesh, report = self._pipeline()
        path = os.path.join(self.tmp, "manifest.json")
        write_manifest(
            path, self.grammar_path, 2,
            {"total_symbols": len(expansion.tree)},
            result, mesh, report,
        )
        payload = json.load(open(path, encoding="utf-8"))
        self.assertTrue(payload["procedural"])
        self.assertIsNone(payload["random_seed"])
        self.assertTrue(payload["branches"])
        self.assertIn("rules_used", payload["branches"][0])

    def test_svg_contains_rule_legend(self):
        _, _, result, _, _ = self._pipeline()
        path = os.path.join(self.tmp, "view.svg")
        write_svg(result, path, "test tree")
        content = open(path, encoding="utf-8").read()
        self.assertIn("<svg", content)
        self.assertIn("A:", content)

    def test_cli_generate_writes_all_artifacts(self):
        outdir = os.path.join(self.tmp, "out")
        exit_code = main([
            "generate", self.grammar_path, "2", "--outdir", outdir,
        ])
        self.assertEqual(exit_code, 0)
        for name in (
            "tree.obj", "tree.derivation.json", "tree.derivation.dot",
            "tree.manifest.json", "tree.xy.svg", "tree.yz.svg",
        ):
            self.assertTrue(
                os.path.exists(os.path.join(outdir, name)), name
            )

    def test_cli_check_reports_syntax_error_position(self):
        bad = os.path.join(self.tmp, "bad.lsys")
        with open(bad, "w", encoding="utf-8") as handle:
            handle.write("axiom A\nA -> F [ F\n")
        exit_code = main(["check", bad])
        self.assertEqual(exit_code, 1)


if __name__ == "__main__":
    unittest.main()
