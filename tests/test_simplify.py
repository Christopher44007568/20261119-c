from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from qem_simplify import ObjMesh, SimplifyOptions, load_obj, save_obj, simplify_mesh


ROOT = Path(__file__).resolve().parents[1]
FEATURE_BOX = ROOT / "examples" / "feature_box.obj"


class ObjIoTest(unittest.TestCase):
    def test_polygons_are_triangulated_and_materials_are_kept(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "quad.obj"
            source.write_text(
                "v 0 0 0\n"
                "v 1 0 0\n"
                "v 1 1 0\n"
                "v 0 1 0\n"
                "usemtl Paint\n"
                "f 1/1 2/1 3/1 4/1\n",
                encoding="utf-8",
            )
            mesh = load_obj(source)
            self.assertEqual(mesh.vertex_count, 4)
            self.assertEqual(mesh.face_count, 2)
            self.assertEqual(mesh.face_materials, ["Paint", "Paint"])

            output = Path(temp_dir) / "out.obj"
            save_obj(
                output,
                mesh.vertices,
                mesh.faces,
                mesh.face_materials,
            )
            reloaded = load_obj(output)
            self.assertEqual(reloaded.vertex_count, mesh.vertex_count)
            self.assertEqual(reloaded.face_count, mesh.face_count)
            self.assertEqual(reloaded.face_materials, mesh.face_materials)


class SimplificationTest(unittest.TestCase):
    def test_feature_box_reaches_target_and_round_trips(self) -> None:
        mesh = load_obj(FEATURE_BOX)
        result = simplify_mesh(mesh, SimplifyOptions(target_faces=150))

        self.assertTrue(result.reached_target)
        self.assertEqual(result.stop_reason, "target_faces_reached")
        self.assertLessEqual(result.final_face_count, 150)
        self.assertGreater(result.final_face_count, 0)
        self.assertGreater(len(result.rounds), 0)
        self.assertTrue(result.validation["topology_preserved"])
        self.assertTrue(result.validation["material_seam_edges_preserved"])
        self.assertTrue(result.validation["sharp_feature_edges_preserved"])
        self.assertGreater(result.validation["link_condition_checks_passed"], 0)
        self.assertGreater(result.validation["flip_checks_passed"], 0)
        self.assertGreater(result.rejected["face_flip"], 0)

        cumulative = 0.0
        for expected_round, item in enumerate(result.rounds, 1):
            self.assertEqual(item["round"], expected_round)
            self.assertGreaterEqual(item["quadric_error"], 0.0)
            self.assertGreater(len(item["source_faces"]), 0)
            cumulative += item["quadric_error"]
            self.assertAlmostEqual(item["cumulative_error"], cumulative)

        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "simplified.obj"
            save_obj(
                output,
                result.vertices,
                result.faces,
                result.face_materials,
            )
            reloaded = load_obj(output)
            self.assertEqual(reloaded.vertex_count, result.final_vertex_count)
            self.assertEqual(reloaded.face_count, result.final_face_count)
            self.assertEqual(
                sorted(set(reloaded.face_materials)),
                ["BodyGray", "PanelBlue", "TopRed"],
            )

    def test_constraint_stop_is_reported_before_target(self) -> None:
        mesh = load_obj(FEATURE_BOX)
        result = simplify_mesh(mesh, SimplifyOptions(target_faces=20))

        self.assertFalse(result.reached_target)
        self.assertEqual(result.stop_reason, "constraints_exhausted")
        self.assertGreater(result.final_face_count, 20)
        self.assertIn("target 20", result.stop_detail)
        self.assertIn("material_seam_edges=", result.stop_detail)
        self.assertGreater(
            result.rejected["protected_material_seam_vertex"]
            + result.rejected["protected_sharp_vertex"],
            0,
        )
        self.assertTrue(result.validation["topology_preserved"])

    def test_open_boundary_vertices_are_locked(self) -> None:
        mesh = ObjMesh(
            vertices=[
                (0.0, 0.0, 0.0),
                (1.0, 0.0, 0.0),
                (1.0, 1.0, 0.0),
                (0.0, 1.0, 0.0),
            ],
            faces=[(0, 1, 2), (0, 2, 3)],
            face_materials=[None, None],
        )
        result = simplify_mesh(mesh, SimplifyOptions(target_faces=0))

        self.assertEqual(result.final_face_count, 2)
        self.assertEqual(result.stop_reason, "constraints_exhausted")
        self.assertEqual(result.feature_counts["boundary_edges"], 4)
        self.assertGreater(result.rejected["protected_boundary_vertex"], 0)
        self.assertTrue(result.validation["boundary_edges_preserved"])

    def test_link_condition_blocks_tetrahedron_collapse(self) -> None:
        mesh = ObjMesh(
            vertices=[
                (0.0, 0.0, 0.0),
                (1.0, 0.0, 0.0),
                (0.0, 1.0, 0.0),
                (0.0, 0.0, 1.0),
            ],
            faces=[(0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)],
            face_materials=[None, None, None, None],
        )
        result = simplify_mesh(
            mesh,
            SimplifyOptions(target_faces=0, protect_sharp=False),
        )

        self.assertEqual(result.final_face_count, 4)
        self.assertGreater(
            result.rejected["topology_duplicate_face"]
            + result.rejected["topology_link_condition"],
            0,
        )
        self.assertTrue(result.validation["topology_preserved"])


class CliTest(unittest.TestCase):
    def test_cli_writes_history_and_matching_obj_counts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "out.obj"
            history = Path(temp_dir) / "history.json"
            report = Path(temp_dir) / "report.json"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "simplify.py"),
                    str(FEATURE_BOX),
                    "--target-faces",
                    "150",
                    "--output",
                    str(output),
                    "--history",
                    str(history),
                    "--report",
                    str(report),
                ],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            report_data = json.loads(report.read_text(encoding="utf-8"))
            history_data = json.loads(history.read_text(encoding="utf-8"))
            self.assertTrue(report_data["obj_roundtrip"]["counts_match"])
            self.assertEqual(
                report_data["final"]["vertices"],
                report_data["obj_roundtrip"]["reloaded_vertices"],
            )
            self.assertEqual(
                report_data["final"]["faces"],
                report_data["obj_roundtrip"]["reloaded_faces"],
            )
            self.assertEqual(
                len(history_data["collapses"]),
                report_data["collapse_count"],
            )
            self.assertTrue(history_data["collapses"][0]["source_faces"])


if __name__ == "__main__":
    unittest.main()
