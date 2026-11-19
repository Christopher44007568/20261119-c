"""把网格与两种 BVH（含 refit 前后）导出为查看器可用的 JS 数据文件。

输出 viewer/scene-data.js，定义 window.BVH_SCENE，file:// 直接打开即可。
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bvh_picker import BVH, Ray, brute_force_pick
from bvh_picker.bvh import BuildConfig
from bvh_picker.mesh import make_grid


def _node_dict(node) -> dict:
    data = {
        "id": node.id,
        "depth": node.depth,
        "box": node.box.to_dict(),
        "leaf": node.is_leaf,
        "triIds": list(node.tri_ids),
        "left": node.left.id if node.left else None,
        "right": node.right.id if node.right else None,
    }
    return data


def _tree_dict(tree: BVH) -> dict:
    stats = tree.stats()
    return {
        "strategy": tree.config.strategy,
        "rootId": tree.root.id,
        "nodes": [_node_dict(n) for n in tree.nodes()],
        "stats": {
            "nodeCount": stats.node_count,
            "leafCount": stats.leaf_count,
            "maxDepth": stats.max_depth,
            "maxLeafTris": stats.max_leaf_tris,
            "sahCost": round(stats.sah_cost, 4),
            "nodeSurface": round(stats.total_node_surface, 4),
            "nodeVolume": round(stats.total_node_volume, 6),
        },
        "degraded": tree.degraded,
        "degradeReasons": list(tree.degrade_reasons),
    }


def _trace(tree: BVH, ray: Ray) -> dict:
    result = tree.traverse(ray)
    brute = brute_force_pick(tree.mesh, ray)
    hit = result["hit"]
    return {
        "order": [
            {
                "nodeId": rec["node_id"],
                "depth": rec["depth"],
                "kind": rec["kind"],
                "t": None if rec["t"] is None else round(rec["t"], 6),
                "triId": rec.get("tri_id"),
            }
            for rec in result["order"]
        ],
        "nodesTested": result["nodes_tested"],
        "trisTested": result["tris_tested"],
        "hit": None
        if hit is None
        else {
            "triId": hit.tri_id,
            "t": round(hit.t, 6),
            "point": [round(v, 6) for v in hit.point],
            "bary": [round(v, 6) for v in hit.bary],
        },
        "bruteHit": None
        if brute is None
        else {
            "triId": brute.tri_id,
            "t": round(brute.t, 6),
            "point": [round(v, 6) for v in brute.point],
            "bary": [round(v, 6) for v in brute.bary],
        },
    }


def build_scene() -> dict:
    mesh = make_grid(10, 10)
    demo_ray = Ray.make((-3.5, 4.0, -3.0), (0.55, -0.65, 0.55))

    trees = {
        strategy: BVH(mesh, BuildConfig(strategy=strategy))
        for strategy in ("median", "sah")
    }
    scene = {
        "meshName": mesh.name,
        "vertices": [list(v) for v in mesh.vertices],
        "triangles": [list(t) for t in mesh.triangles],
        "ray": {
            "origin": list(demo_ray.origin),
            "direction": list(demo_ray.direction),
        },
        "trees": {},
    }
    for strategy, tree in trees.items():
        tree_data = _tree_dict(tree)
        tree_data["trace"] = _trace(tree, demo_ray)
        scene["trees"][strategy] = tree_data

    # 形变 + refit 场景：拉出一个顶点，先 refit 再 rebuild
    far_index = mesh.triangles[len(mesh.triangles) // 2][0]
    moved_vertex = {"index": far_index, "from": list(mesh.vertices[far_index])}
    mesh.move_vertex(far_index, (0.0, 12.0, 0.0))
    moved_vertex["to"] = list(mesh.vertices[far_index])
    scene["movedVertex"] = moved_vertex
    scene["refit"] = {}
    for strategy, tree in trees.items():
        tree.refit()
        refit_data = _tree_dict(tree)
        refit_data["trace"] = _trace(tree, demo_ray)
        scene["refit"][strategy] = refit_data
        tree.rebuild()
        rebuilt_data = _tree_dict(tree)
        rebuilt_data["trace"] = _trace(tree, demo_ray)
        scene["refit"][strategy]["rebuilt"] = rebuilt_data

    scene["refitRay"] = {
        "origin": list(demo_ray.origin),
        "direction": list(demo_ray.direction),
    }
    return scene


def main() -> None:
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "viewer")
    os.makedirs(out_dir, exist_ok=True)
    scene = build_scene()
    out = os.path.join(out_dir, "scene-data.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("// 由 tools/export_scene.py 生成，勿手改\n")
        f.write("window.BVH_SCENE = ")
        json.dump(scene, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    sizes = {k: len(v["nodes"]) for k, v in scene["trees"].items()}
    print(f"已写出 {out}，节点数 {sizes}")


if __name__ == "__main__":
    main()
