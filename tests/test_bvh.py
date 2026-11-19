"""BVH 射线拾取器测试（纯 unittest，标准库即可运行）。

运行：python3 -m unittest discover -s tests -v
"""

import math
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bvh_picker import BVH, Ray, brute_force_pick, ray_aabb, ray_triangle
from bvh_picker.aabb import AABB
from bvh_picker.bvh import BuildConfig
from bvh_picker.mesh import Mesh, make_cube, make_grid, make_uv_sphere

T_TOL = 1e-7


def _same_hit(a, b) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if abs(a.t - b.t) > T_TOL:
        return False
    return all(abs(a.point[k] - b.point[k]) < 1e-6 for k in range(3))


class CorrectnessFuzzTests(unittest.TestCase):
    """对随机射线与随机网格，BVH 结果必须与暴力求交一致。"""

    def setUp(self):
        rng = random.Random(20261119)
        self.meshes = [
            make_cube(),
            make_grid(6, 6),
            make_uv_sphere(sectors=12, stacks=8),
            self._random_mesh(rng, 60),
        ]
        self.trees = {
            strat: [BVH(m, BuildConfig(strategy=strat)) for m in self.meshes]
            for strat in ("median", "sah")
        }

    @staticmethod
    def _random_mesh(rng, n_tris):
        verts, tris = [], []
        for _ in range(n_tris):
            base = len(verts)
            for _ in range(3):
                verts.append((
                    rng.uniform(-2, 2),
                    rng.uniform(-2, 2),
                    rng.uniform(-2, 2),
                ))
            tris.append((base, base + 1, base + 2))
        return Mesh(verts, tris, "random")

    def _random_rays(self, rng, n=300):
        for _ in range(n):
            origin = tuple(rng.uniform(-6, 6) for _ in range(3))
            direction = tuple(rng.uniform(-1, 1) for _ in range(3))
            if math.dist(direction, (0, 0, 0)) < 1e-6:
                continue
            yield Ray.make(origin, direction)

    def test_matches_brute_force(self):
        rng = random.Random(42)
        for strat, trees in self.trees.items():
            for mesh, tree in zip(self.meshes, trees):
                checked = 0
                for ray in self._random_rays(rng):
                    expected = brute_force_pick(mesh, ray)
                    got = tree.pick(ray)
                    self.assertTrue(
                        _same_hit(expected, got),
                        f"{strat}/{mesh.name} 不一致: ray={ray}, "
                        f"brute={expected}, bvh={got}",
                    )
                    checked += 1
                self.assertGreater(checked, 100)

    def test_traversal_visits_only_intersecting_boxes(self):
        """访问顺序里每个被进入的节点包围盒都必须与射线真实相交。"""
        rng = random.Random(7)
        tree = self.trees["sah"][2]
        for ray in self._random_rays(rng, 50):
            result = tree.traverse(ray)
            by_id = {n.id: n for n in tree.nodes()}
            for rec in result["order"]:
                if rec["kind"] == "miss":
                    self.assertIsNone(
                        ray_aabb(ray, by_id[rec["node_id"]].box),
                        "被标记 miss 的节点实际上与射线相交",
                    )
                elif rec["kind"] == "box":
                    self.assertIsNotNone(
                        ray_aabb(ray, by_id[rec["node_id"]].box),
                        "被标记进入的节点实际上未与射线相交",
                    )

    def test_bvh_fewer_tests_than_brute_force(self):
        """典型场景下 BVH 的三角形测试数应显著少于全量遍历。"""
        mesh = make_uv_sphere(sectors=16, stacks=10)
        tree = BVH(mesh, BuildConfig(strategy="sah"))
        ray = Ray.make((4, 4, 4), (-1, -1, -1))
        result = tree.traverse(ray)
        self.assertLess(result["tris_tested"], len(mesh.triangles) // 2)
        self.assertIsNotNone(result["hit"])


class StrategyComparisonTests(unittest.TestCase):
    """中位数切分 vs SAH：树质量与遍历效率对比。"""

    def test_sah_cost_no_worse_than_median(self):
        mesh = make_uv_sphere(sectors=18, stacks=12)
        median = BVH(mesh, BuildConfig(strategy="median"))
        sah = BVH(mesh, BuildConfig(strategy="sah"))
        self.assertLessEqual(
            sah.stats().sah_cost,
            median.stats().sah_cost + 1e-9,
        )

    def test_sah_uses_fewer_ray_tests_on_grid(self):
        mesh = make_grid(12, 12)
        rng = random.Random(3)
        median = BVH(mesh, BuildConfig(strategy="median"))
        sah = BVH(mesh, BuildConfig(strategy="sah"))
        med_tri = sah_tri = med_box = sah_box = 0
        rays = list(self._rays(rng, 80))
        for ray in rays:
            med_tri += median.traverse(ray)["tris_tested"]
            sah_tri += sah.traverse(ray)["tris_tested"]
            med_box += median.traverse(ray)["nodes_tested"]
            sah_box += sah.traverse(ray)["nodes_tested"]
        # 分布均匀时两者接近，但 SAH 不应更差
        self.assertLessEqual(sah_tri, med_tri)
        self.assertLessEqual(sah_box, med_box)

    @staticmethod
    def _rays(rng, n):
        for _ in range(n):
            yield Ray.make(
                tuple(rng.uniform(-5, 5) for _ in range(3)),
                tuple(rng.uniform(-1, 1) for _ in range(3)),
            )


class EdgeCaseTests(unittest.TestCase):
    """擦边、平行、内部出发等数值敏感场景，与暴力求交逐一对齐。"""

    def setUp(self):
        self.mesh = make_cube(2.0)
        self.trees = {
            strat: BVH(self.mesh, BuildConfig(strategy=strat))
            for strat in ("median", "sah")
        }

    def _assert_agrees(self, ray):
        expected = brute_force_pick(self.mesh, ray)
        for strat, tree in self.trees.items():
            got = tree.pick(ray)
            self.assertTrue(
                _same_hit(expected, got),
                f"{strat} 与暴力不一致: {ray} / {expected} / {got}",
            )
        return expected

    def test_parallel_ray_misses(self):
        # 方向平行于顶面 y=2，从外侧掠过，不应命中
        ray = Ray.make((-4, 2.0 + 1e-4, 0), (1, 0, 0))
        self.assertIsNone(self._assert_agrees(ray))

    def test_parallel_ray_inside_plane_misses(self):
        # 完全落在三角形平面内但在面外侧，平行射线只能擦过而非穿透
        ray = Ray.make((-4, 2.0, 3.0), (1, 0, 0))
        self.assertIsNone(self._assert_agrees(ray))

    def test_grazing_ray_along_edge(self):
        # 沿立方体棱线 x=2,z=2 外侧极近处擦过
        ray = Ray.make((2.0 + 1e-6, -4, 2.0 + 1e-6), (0, 1, 0))
        self._assert_agrees(ray)

    def test_grazing_ray_on_face(self):
        # 恰好贴着 y=2 顶面行进（容差内），结果必须与暴力一致
        ray = Ray.make((-4, 2.0, 0.5), (1, 0, 0))
        self._assert_agrees(ray)

    def test_ray_origin_inside_mesh(self):
        # 从立方体中心向外，命中距离约为 2，且不会自交
        ray = Ray.make((0, 0, 0), (0, 0, 1))
        hit = self._assert_agrees(ray)
        self.assertIsNotNone(hit)
        self.assertAlmostEqual(hit.t, 2.0, places=6)
        self.assertAlmostEqual(hit.point[2], 2.0, places=6)

    def test_ray_origin_on_surface(self):
        # 起点在表面上，向外射线应跳过自交、报告无命中
        ray_out = Ray.make((0, 0, 2.0), (0, 0, 1))
        self.assertIsNone(self._assert_agrees(ray_out))
        # 向内射线应命中对面，距离约 4
        ray_in = Ray.make((0, 0, 2.0), (0, 0, -1))
        hit = self._assert_agrees(ray_in)
        self.assertIsNotNone(hit)
        self.assertAlmostEqual(hit.t, 4.0, places=6)

    def test_ray_origin_inside_sphere(self):
        mesh = make_uv_sphere(radius=1.0, sectors=20, stacks=12)
        tree = BVH(mesh, BuildConfig(strategy="sah"))
        ray = Ray.make((0, 0, 0), (0.3, -0.7, 0.65))
        expected = brute_force_pick(mesh, ray)
        got = tree.pick(ray)
        self.assertTrue(_same_hit(expected, got))
        self.assertAlmostEqual(got.t, 1.0, delta=0.02)

    def test_ray_misses_everything(self):
        ray = Ray.make((10, 10, 10), (1, 0, 0))
        result = self.trees["sah"].traverse(ray)
        self.assertIsNone(result["hit"])
        self.assertEqual(result["tris_tested"], 0)

    def test_barycentric_coords_reconstruct_point(self):
        """用重心坐标与三角形顶点重建命中点，应与 ray.at(t) 重合。"""
        mesh = make_uv_sphere(sectors=14, stacks=9)
        tree = BVH(mesh, BuildConfig(strategy="sah"))
        rng = random.Random(99)
        for _ in range(50):
            ray = Ray.make(
                tuple(rng.uniform(-5, 5) for _ in range(3)),
                tuple(rng.uniform(-1, 1) for _ in range(3)),
            )
            hit = tree.pick(ray)
            if hit is None:
                continue
            v0, v1, v2 = mesh.tri_points(hit.tri_id)
            u, v = hit.bary
            w = 1.0 - u - v
            recon = tuple(
                w * v0[k] + u * v1[k] + v * v2[k] for k in range(3)
            )
            for k in range(3):
                self.assertAlmostEqual(recon[k], hit.point[k], places=5)
            self.assertGreaterEqual(u, 0.0)
            self.assertGreaterEqual(v, 0.0)
            self.assertGreaterEqual(w, -1e-9)


class RefitTests(unittest.TestCase):
    """顶点移动后的 refit、质量恶化检测与 rebuild 恢复。"""

    def test_refit_keeps_results_correct(self):
        mesh = make_grid(8, 8)
        tree = BVH(mesh, BuildConfig(strategy="sah"))
        rng = random.Random(5)
        # 小幅抖动所有顶点
        mesh.displace(lambda p: (
            p[0] + rng.uniform(-0.05, 0.05),
            p[1] + rng.uniform(-0.05, 0.05),
            p[2] + rng.uniform(-0.05, 0.05),
        ))
        tree.refit()
        for _ in range(100):
            ray = Ray.make(
                tuple(rng.uniform(-5, 5) for _ in range(3)),
                tuple(rng.uniform(-1, 1) for _ in range(3)),
            )
            self.assertTrue(
                _same_hit(brute_force_pick(mesh, ray), tree.pick(ray))
            )

    def test_refit_detects_degradation(self):
        mesh = make_grid(10, 10)
        tree = BVH(mesh, BuildConfig(strategy="sah", degrade_ratio=1.25))
        # 把一个顶点拉得很远，refit 后包围盒出现大量空隙 -> 质量恶化
        far_index = mesh.triangles[len(mesh.triangles) // 2][0]
        mesh.move_vertex(far_index, (0.0, 12.0, 0.0))
        tree.refit()
        self.assertTrue(
            tree.degraded,
            f"应检测到恶化，原因: {tree.degrade_reasons}",
        )
        self.assertTrue(tree.degrade_reasons)

    def test_rebuild_restores_quality(self):
        mesh = make_grid(10, 10)
        tree = BVH(mesh, BuildConfig(strategy="sah"))
        baseline_cost = tree.stats().sah_cost
        far_index = mesh.triangles[len(mesh.triangles) // 2][0]
        mesh.move_vertex(far_index, (0.0, 12.0, 0.0))
        tree.refit()
        self.assertTrue(tree.degraded)
        tree.rebuild()
        self.assertFalse(tree.degraded)
        self.assertLessEqual(tree.stats().sah_cost, baseline_cost * 1.1 + 1e-9)

    def test_refit_boxes_still_contain_triangles(self):
        mesh = make_uv_sphere(sectors=10, stacks=6)
        tree = BVH(mesh, BuildConfig(strategy="median"))
        rng = random.Random(11)
        mesh.displace(lambda p: (
            p[0], p[1] + rng.uniform(-1.5, 1.5), p[2]
        ))
        tree.refit()
        for node in tree.nodes():
            if not node.is_leaf:
                continue
            for tri_id in node.tri_ids:
                tri_box = mesh.tri_box(tri_id)
                for axis in range(3):
                    # 节点盒必须包含其下每个三角形盒
                    self.assertLessEqual(
                        node.box.lo[axis], tri_box.lo[axis] + 1e-9
                    )
                    self.assertGreaterEqual(
                        node.box.hi[axis], tri_box.hi[axis] - 1e-9
                    )
