import random
import unittest

from voxelmesh import World
from voxelmesh.mesher import face_metrics, quad_unit_keys


class WorldTests(unittest.TestCase):
    def _build_two_chunk_world(self):
        world = World(chunk_size=(4, 4, 4))
        # 两个相邻分块各填一块实体，跨 x=4 边界贴合。
        world.fill_box((0, 0, 0), (4, 4, 4), 1)
        world.fill_box((4, 0, 0), (8, 4, 4), 2)
        world.rebuild_all()
        return world

    def test_initial_mesh_matches_naive_reference(self):
        world = self._build_two_chunk_world()
        report = world.verify_against_naive()
        self.assertTrue(report["matches"], report)
        self.assertFalse(report["duplicate_internal_faces"])

    def test_boundary_edit_invalidates_both_chunks(self):
        world = self._build_two_chunk_world()
        # (3,0,0) 位于左块 x 最大边界，删除会暴露右块朝向 -x 的面。
        result = world.delete_voxel(3, 0, 0)
        self.assertTrue(result.existed)
        self.assertIn((0, 0, 0), result.invalidated)
        self.assertIn((1, 0, 0), result.invalidated)
        self.assertEqual(len(result.rebuilt), 2)
        report = world.verify_against_naive()
        self.assertTrue(report["matches"], report)

    def test_no_duplicate_faces_across_chunk_border(self):
        world = self._build_two_chunk_world()
        for position in ((3, 1, 1), (4, 1, 1), (3, 3, 3), (4, 0, 0)):
            world.delete_voxel(*position)
        report = world.verify_against_naive()
        self.assertTrue(report["matches"], report)
        all_quads = world.all_quads()
        keys = quad_unit_keys(all_quads)
        self.assertEqual(len(keys), sum(q.area for q in all_quads))

    def test_interior_delete_only_rebuilds_one_chunk(self):
        world = World(chunk_size=(6, 6, 6))
        world.fill_box((0, 0, 0), (6, 6, 6), 1)
        world.rebuild_all()
        result = world.delete_voxel(3, 3, 3)
        self.assertEqual(result.invalidated, [(0, 0, 0)])
        self.assertEqual(result.quad_delta, +6)   # 内洞新增 6 个单位面
        self.assertEqual(result.unit_delta, +6)
        self.assertTrue(world.verify_against_naive()["matches"])

    def test_surface_delete_face_count_change(self):
        world = World(chunk_size=(4, 4, 4))
        world.fill_box((0, 0, 0), (4, 4, 4), 1)
        world.rebuild_all()
        result = world.delete_voxel(0, 0, 0)  # 角体素
        # 移除 3 个外表面，新增 3 个内侧面：单位面净变化为 0。
        self.assertEqual(result.unit_delta, 0)
        self.assertTrue(world.verify_against_naive()["matches"])

    def test_delete_air_is_noop(self):
        world = self._build_two_chunk_world()
        before = world.counts()
        result = world.delete_voxel(100, 100, 100)
        self.assertFalse(result.existed)
        self.assertEqual(result.invalidated, [])
        self.assertEqual(result.rebuilt, [])
        self.assertEqual(world.counts(), before)

    def test_external_area_and_boundary_against_reference(self):
        world = self._build_two_chunk_world()
        naive_quads = world.naive_reference_quads()
        greedy_metrics = world.metrics()
        naive_metrics = face_metrics(naive_quads, world.get_material)
        self.assertEqual(greedy_metrics, naive_metrics)
        # 跨材质界面：4x4 截面两侧各 16 个单位面。
        self.assertEqual(greedy_metrics["boundary"], 32)

    def test_random_edits_always_match_reference(self):
        random.seed(20261119)
        world = World(chunk_size=(4, 4, 4))
        for _ in range(120):
            coord = (
                random.randrange(0, 9),
                random.randrange(0, 5),
                random.randrange(0, 5),
            )
            world.set_voxel(*coord, random.randrange(1, 4))
        world.rebuild_all()
        self.assertTrue(world.verify_against_naive()["matches"])
        for _ in range(40):
            coord = (
                random.randrange(0, 9),
                random.randrange(0, 5),
                random.randrange(0, 5),
            )
            world.delete_voxel(*coord)
            report = world.verify_against_naive()
            self.assertTrue(report["matches"], (coord, report))


if __name__ == "__main__":
    unittest.main()
