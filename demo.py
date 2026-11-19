"""命令行演示：建树对比、边界射线验证、refit 与质量恶化。

用法：
  python3 demo.py              # 完整演示
  python3 demo.py --mesh grid  # 指定网格 cube/grid/sphere
"""

from __future__ import annotations

import argparse
import random
import time

from bvh_picker import BVH, Ray, brute_force_pick
from bvh_picker.bvh import BuildConfig
from bvh_picker.mesh import make_cube, make_grid, make_uv_sphere


def _hr(title: str) -> None:
    print(f"\n=== {title} ===")


def build_comparison(mesh) -> dict[str, BVH]:
    _hr("建树对比：中位数切分 vs 表面积启发式（SAH）")
    trees = {}
    for strategy in ("median", "sah"):
        t0 = time.perf_counter()
        tree = BVH(mesh, BuildConfig(strategy=strategy))
        elapsed = (time.perf_counter() - t0) * 1000
        s = tree.stats()
        trees[strategy] = tree
        print(
            f"{strategy:>6} | 节点 {s.node_count:4d} | 叶子 {s.leaf_count:4d} | "
            f"最大深度 {s.max_depth:2d} | SAH 成本 {s.sah_cost:7.2f} | "
            f"建树 {elapsed:6.1f} ms"
        )
    return trees


def ray_benchmark(mesh, trees: dict[str, BVH], n_rays: int = 2000) -> None:
    _hr(f"随机射线基准（{n_rays} 条，对照暴力求交）")
    rng = random.Random(2026)
    rays = [
        Ray.make(
            tuple(rng.uniform(-5, 5) for _ in range(3)),
            tuple(rng.uniform(-1, 1) for _ in range(3)),
        )
        for _ in range(n_rays)
    ]

    t0 = time.perf_counter()
    brute_hits = [brute_force_pick(mesh, r) for r in rays]
    brute_ms = (time.perf_counter() - t0) * 1000
    print(f"{'brute':>6} | {brute_ms:8.1f} ms | 每条射线测试 {len(mesh.triangles)} 个三角形")

    for name, tree in trees.items():
        t0 = time.perf_counter()
        box_tests = tri_tests = 0
        mismatches = 0
        for ray, expected in zip(rays, brute_hits):
            result = tree.traverse(ray)
            box_tests += result["nodes_tested"]
            tri_tests += result["tris_tested"]
            got = result["hit"]
            if (got is None) != (expected is None):
                mismatches += 1
            elif got is not None and abs(got.t - expected.t) > 1e-7:
                mismatches += 1
        elapsed = (time.perf_counter() - t0) * 1000
        print(
            f"{name:>6} | {elapsed:8.1f} ms | 平均 AABB 测试 {box_tests / n_rays:5.1f} | "
            f"平均三角形测试 {tri_tests / n_rays:5.1f} | 与暴力不一致 {mismatches}"
        )


def edge_cases() -> None:
    _hr("边界场景：擦边 / 平行 / 内部出发（均与暴力求交核对）")
    mesh = make_cube(2.0)
    tree = BVH(mesh, BuildConfig(strategy="sah"))
    cases = [
        ("平行于顶面外侧掠过", Ray.make((-4, 2.0001, 0), (1, 0, 0))),
        ("平面外侧平行射线", Ray.make((-4, 2.0, 3.0), (1, 0, 0))),
        ("沿棱线擦边", Ray.make((2.000001, -4, 2.000001), (0, 1, 0))),
        ("立方体中心向外", Ray.make((0, 0, 0), (0, 0, 1))),
        ("表面起点向外(跳过自交)", Ray.make((0, 0, 2.0), (0, 0, 1))),
        ("表面起点向内", Ray.make((0, 0, 2.0), (0, 0, -1))),
        ("完全偏离的射线", Ray.make((10, 10, 10), (1, 0, 0))),
    ]
    for label, ray in cases:
        expected = brute_force_pick(mesh, ray)
        got = tree.pick(ray)
        ok = (got is None and expected is None) or (
            got is not None and expected is not None and abs(got.t - expected.t) < 1e-7
        )
        if got is None:
            detail = "未命中"
        else:
            u, v = got.bary
            detail = (
                f"三角形 #{got.tri_id} t={got.t:.4f} "
                f"重心=({1 - u - v:.3f},{u:.3f},{v:.3f})"
            )
        print(f"[{'OK' if ok else 'FAIL'}] {label:<22} -> {detail}")


def refit_demo() -> None:
    _hr("顶点移动 -> refit -> 质量恶化检测 -> rebuild 恢复")
    mesh = make_grid(10, 10)
    tree = BVH(mesh, BuildConfig(strategy="sah"))
    base = tree.stats()
    print(f"初始状态：SAH 成本 {base.sah_cost:.2f}，节点总表面积 {base.total_node_surface:.2f}")

    far_index = mesh.triangles[len(mesh.triangles) // 2][0]
    mesh.move_vertex(far_index, (0.0, 12.0, 0.0))
    refit_stats = tree.refit()
    print(
        f"refit 后：SAH 成本 {refit_stats.sah_cost:.2f}，"
        f"节点总表面积 {refit_stats.total_node_surface:.2f}，"
        f"恶化={tree.degraded}"
    )
    for reason in tree.degrade_reasons:
        print(f"  - {reason}")

    rng = random.Random(7)
    mismatches = sum(
        1
        for _ in range(200)
        if not _agree(
            tree.pick(r := Ray.make(
                tuple(rng.uniform(-5, 5) for _ in range(3)),
                tuple(rng.uniform(-1, 1) for _ in range(3)),
            )),
            brute_force_pick(mesh, r),
        )
    )
    print(f"refit 后 200 条随机射线与暴力求交不一致数：{mismatches}")

    rebuilt = tree.rebuild()
    print(
        f"rebuild 后：SAH 成本 {rebuilt.sah_cost:.2f}，"
        f"节点总表面积 {rebuilt.total_node_surface:.2f}，恶化={tree.degraded}"
    )


def _agree(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(a.t - b.t) < 1e-7


def main() -> None:
    parser = argparse.ArgumentParser(description="BVH 射线拾取器演示")
    parser.add_argument("--mesh", choices=["cube", "grid", "sphere"], default="sphere")
    args = parser.parse_args()
    meshes = {
        "cube": make_cube(),
        "grid": make_grid(12, 12),
        "sphere": make_uv_sphere(sectors=18, stacks=12),
    }
    mesh = meshes[args.mesh]
    print(f"网格：{mesh.name}，顶点 {len(mesh.vertices)}，三角形 {len(mesh.triangles)}")
    trees = build_comparison(mesh)
    ray_benchmark(mesh, trees)
    edge_cases()
    refit_demo()


if __name__ == "__main__":
    main()
