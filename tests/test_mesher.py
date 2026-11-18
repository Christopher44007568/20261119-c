import unittest

from voxelmesh.mesher import (
    DIRS,
    face_metrics,
    greedy_chunk_mesh,
    naive_mesh,
    quad_unit_keys,
)


def dict_world(voxels):
    return lambda x, y, z: voxels.get((x, y, z), 0)


class MesherTests(unittest.TestCase):
    def test_single_voxel_six_faces(self):
        voxels = {(0, 0, 0): 1}
        quads = greedy_chunk_mesh((0, 0, 0), (2, 2, 2), dict_world(voxels))
        self.assertEqual(len(quads), 6)
        self.assertEqual(sum(q.area for q in quads), 6)
        metrics = face_metrics(quads, dict_world(voxels))
        self.assertEqual(metrics, {"unit_faces": 6, "external": 6, "boundary": 0})

    def test_solid_cube_greedy_merges_to_six_quads(self):
        voxels = {
            (x, y, z): 1
            for x in range(4) for y in range(4) for z in range(4)
        }
        quads = greedy_chunk_mesh((0, 0, 0), (4, 4, 4), dict_world(voxels))
        self.assertEqual(len(quads), 6)  # 每面合并为一个大矩形
        self.assertEqual(sum(q.area for q in quads), 6 * 16)

    def test_greedy_matches_naive_unit_faces(self):
        voxels = {
            (x, y, z): ((x + y + z) % 3) + 1
            for x in range(5) for y in range(5) for z in range(5)
            if (x * 7 + y * 3 + z) % 4 != 0
        }
        get = dict_world(voxels)
        greedy = greedy_chunk_mesh((0, 0, 0), (5, 5, 5), get)
        reference = naive_mesh(get, ((0, 0, 0), (5, 5, 5)))
        self.assertEqual(
            quad_unit_keys(greedy), quad_unit_keys(reference)
        )

    def test_same_material_internal_faces_culled(self):
        voxels = {
            (x, y, z): 1
            for x in range(2) for y in range(2) for z in range(2)
        }
        quads = greedy_chunk_mesh((0, 0, 0), (2, 2, 2), dict_world(voxels))
        self.assertEqual(sum(q.area for q in quads), 24)  # 仅外表，无内部面

    def test_material_boundary_preserved_and_counted(self):
        # 两个 2x2x2 不同材质方块沿 x 贴合：共享 4 个分界面（两侧各 4 面）。
        voxels = {}
        for x in range(2):
            for y in range(2):
                for z in range(2):
                    voxels[(x, y, z)] = 1
                    voxels[(x + 2, y, z)] = 2
        get = dict_world(voxels)
        quads = greedy_chunk_mesh((0, 0, 0), (4, 2, 2), get)
        metrics = face_metrics(quads, get)
        # 外表：两个方块各自 5 个外露方向，共 40；分界：8。
        self.assertEqual(metrics["external"], 40)
        self.assertEqual(metrics["boundary"], 8)
        reference = naive_mesh(get, ((0, 0, 0), (4, 2, 2)))
        self.assertEqual(quad_unit_keys(quads), quad_unit_keys(reference))

    def test_no_duplicate_unit_faces(self):
        voxels = {
            (x, y, z): (x % 2) + 1
            for x in range(6) for y in range(3) for z in range(3)
        }
        get = dict_world(voxels)
        quads = greedy_chunk_mesh((0, 0, 0), (6, 3, 3), get)
        keys = quad_unit_keys(quads)
        self.assertEqual(len(keys), sum(q.area for q in quads))
        # 每个单位面 key 唯一，且朝向合法。
        for _, dir_index in keys:
            self.assertIn(dir_index, range(6))
            self.assertEqual(DIRS[dir_index][0], dir_index % 3)


if __name__ == "__main__":
    unittest.main()
