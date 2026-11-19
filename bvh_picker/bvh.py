"""BVH 建树（中位数切分 / 表面积启发式 SAH）、refit 与射线遍历。"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import inf
from typing import Literal

from .aabb import AABB
from .ray import EPS_T, Ray, RayHit, ray_aabb, ray_triangle

BuildStrategy = Literal["median", "sah"]


@dataclass
class BuildConfig:
    strategy: BuildStrategy = "sah"
    max_leaf_size: int = 4
    sah_buckets: int = 12
    sah_traversal_cost: float = 1.0
    sah_intersect_cost: float = 1.0
    # refit 后 SAH 成本或包围盒膨胀超过该比例即判定树质量恶化
    degrade_ratio: float = 1.25


@dataclass
class Node:
    box: AABB
    left: "Node | None" = None
    right: "Node | None" = None
    tri_ids: list[int] = field(default_factory=list)
    id: int = -1
    depth: int = 0

    @property
    def is_leaf(self) -> bool:
        return self.left is None


@dataclass
class TreeStats:
    node_count: int = 0
    leaf_count: int = 0
    max_depth: int = 0
    max_leaf_tris: int = 0
    sum_leaf_tris: int = 0
    sah_cost: float = 0.0          # 以根盒面积归一化的期望遍历成本
    total_node_volume: float = 0.0
    total_node_surface: float = 0.0
    total_leaf_volume: float = 0.0
    total_tri_volume: float = 0.0


class BVH:
    def __init__(self, mesh, config: BuildConfig | None = None):
        self.mesh = mesh
        self.config = config or BuildConfig()
        self.root: Node | None = None
        self._nodes: list[Node] = []
        # refit 前后质量对比
        self._baseline: TreeStats | None = None
        self.degraded: bool = False
        self.degrade_reasons: list[str] = []
        self.build()

    # ------------------------------------------------------------------ build
    def build(self) -> None:
        self._nodes = []
        ids = list(range(len(self.mesh.triangles)))
        self.root = self._build(ids, depth=0)
        self._baseline = self.stats()
        self.degraded = False
        self.degrade_reasons = []

    def _new_node(self, box: AABB, depth: int) -> Node:
        node = Node(box=box, id=len(self._nodes), depth=depth)
        self._nodes.append(node)
        return node

    def _centroid_box(self, ids: list[int]) -> AABB:
        return AABB.from_points(
            self.mesh.tri_box(i).center() for i in ids
        )

    def _build(self, ids: list[int], depth: int) -> Node:
        box = AABB.empty()
        for i in ids:
            box = box.union(self.mesh.tri_box(i))
        node = self._new_node(box, depth)

        if len(ids) <= self.config.max_leaf_size:
            node.tri_ids = ids
            return node

        split = self._find_split(ids, box)
        if split is None:
            node.tri_ids = ids  # 质心完全重合，无法再分
            return node

        left_ids, right_ids = split
        node.left = self._build(left_ids, depth + 1)
        node.right = self._build(right_ids, depth + 1)
        return node

    def _find_split(self, ids: list[int], box: AABB):
        if self.config.strategy == "median":
            return self._median_split(ids)
        return self._sah_split(ids, box)

    def _median_split(self, ids: list[int]):
        """最长轴上按质心中位数切分，保证两侧非空。"""
        cbox = self._centroid_box(ids)
        axis = cbox.longest_axis()
        ordered = sorted(
            ids,
            key=lambda i: self.mesh.tri_box(i).center()[axis],
        )
        mid = len(ordered) // 2
        left, right = ordered[:mid], ordered[mid:]
        # 质心在该轴上全部相等时 mid 处可能仍是同一点，退化为强制对半
        if not left or not right:
            return None
        return left, right

    def _sah_split(self, ids: list[int], box: AABB):
        """分桶 SAH：在最长质心轴上枚举桶边界，取最小期望成本切分。

        成本 = Ct + (SA(left)*Nl + SA(right)*Nr) / SA(parent) * Ci
        若任一分割都不优于直接成叶，则返回 None 让节点成为叶子。
        """
        cfg = self.config
        cbox = self._centroid_box(ids)
        axis = cbox.longest_axis()
        lo = cbox.lo[axis]
        hi = cbox.hi[axis]
        if hi - lo < 1e-15:
            return None

        n_buckets = cfg.sah_buckets
        counts = [0] * n_buckets
        boxes = [AABB.empty() for _ in range(n_buckets)]
        scale = n_buckets / (hi - lo)
        for tri_id in ids:
            c = self.mesh.tri_box(tri_id).center()[axis]
            b = int((c - lo) * scale)
            if b >= n_buckets:
                b = n_buckets - 1
            counts[b] += 1
            boxes[b] = boxes[b].union(self.mesh.tri_box(tri_id))

        parent_sa = box.surface_area()
        leaf_cost = cfg.sah_intersect_cost * len(ids)
        best_cost = leaf_cost
        best_split = -1

        prefix_count = 0
        prefix_box = AABB.empty()
        suffix_count = [0] * n_buckets
        suffix_box = [AABB.empty() for _ in range(n_buckets)]
        run_count = 0
        run_box = AABB.empty()
        for b in range(n_buckets - 1, -1, -1):
            run_count += counts[b]
            run_box = run_box.union(boxes[b])
            suffix_count[b] = run_count
            suffix_box[b] = run_box

        for b in range(n_buckets - 1):
            prefix_count += counts[b]
            prefix_box = prefix_box.union(boxes[b])
            if prefix_count == 0 or suffix_count[b + 1] == 0:
                continue
            cost = cfg.sah_traversal_cost + cfg.sah_intersect_cost * (
                prefix_box.surface_area() * prefix_count
                + suffix_box[b + 1].surface_area() * suffix_count[b + 1]
            ) / parent_sa
            if cost < best_cost:
                best_cost = cost
                best_split = b

        if best_split < 0:
            return None

        left: list[int] = []
        right: list[int] = []
        for tri_id in ids:
            c = self.mesh.tri_box(tri_id).center()[axis]
            b = int((c - lo) * scale)
            if b >= n_buckets:
                b = n_buckets - 1
            (left if b <= best_split else right).append(tri_id)
        if not left or not right:
            return None
        return left, right

    # ----------------------------------------------------------------- stats
    def nodes(self) -> list[Node]:
        return list(self._nodes)

    def stats(self) -> TreeStats:
        s = TreeStats()
        if self.root is None:
            return s

        def walk(node: Node) -> tuple[float, int]:
            """返回 (该子树 SAH 成本, 三角形数)。"""
            s.node_count += 1
            s.total_node_volume += _volume(node.box)
            s.total_node_surface += node.box.surface_area()
            s.max_depth = max(s.max_depth, node.depth)
            if node.is_leaf:
                s.leaf_count += 1
                s.max_leaf_tris = max(s.max_leaf_tris, len(node.tri_ids))
                s.sum_leaf_tris += len(node.tri_ids)
                s.total_leaf_volume += _volume(node.box)
                for tri_id in node.tri_ids:
                    s.total_tri_volume += _volume(self.mesh.tri_box(tri_id))
                return (
                    self.config.sah_intersect_cost * len(node.tri_ids),
                    len(node.tri_ids),
                )
            cl, nl = walk(node.left)
            cr, nr = walk(node.right)
            sa = node.box.surface_area()
            # 标准 SAH 递推：C(N) = Ct + SA(L)/SA(N)*C(L) + SA(R)/SA(N)*C(R)
            if sa <= 0.0:
                own = self.config.sah_traversal_cost + 0.5 * (cl + cr)
            else:
                own = self.config.sah_traversal_cost + (
                    node.left.box.surface_area() * cl
                    + node.right.box.surface_area() * cr
                ) / sa
            return own, nl + nr

        cost, _ = walk(self.root)
        s.sah_cost = cost
        return s

    # ----------------------------------------------------------------- refit
    def refit(self) -> TreeStats:
        """顶点移动后自底向上重算包围盒，不改变拓扑结构。"""
        if self.root is None:
            return self.stats()

        def walk(node: Node) -> AABB:
            if node.is_leaf:
                box = AABB.empty()
                for tri_id in node.tri_ids:
                    box = box.union(self.mesh.tri_box(tri_id))
                node.box = box
                return box
            node.box = walk(node.left).union(walk(node.right))
            return node.box

        walk(self.root)
        self._evaluate_quality()
        return self.stats()

    def _evaluate_quality(self) -> None:
        """对比 refit 前后的 SAH 成本与包围盒膨胀，标记质量恶化。"""
        baseline = self._baseline
        current = self.stats()
        self.degrade_reasons = []
        if baseline is not None and baseline.sah_cost > 0:
            ratio = current.sah_cost / baseline.sah_cost
            if ratio > self.config.degrade_ratio:
                self.degrade_reasons.append(
                    f"SAH 期望成本 {baseline.sah_cost:.2f} -> "
                    f"{current.sah_cost:.2f}（x{ratio:.2f}）"
                )
        if baseline is not None and baseline.total_node_volume > 0:
            ratio = current.total_node_volume / baseline.total_node_volume
            if ratio > self.config.degrade_ratio:
                self.degrade_reasons.append(
                    f"节点包围盒总体积膨胀 x{ratio:.2f}，内部空隙显著增加"
                )
        if baseline is not None and baseline.total_node_surface > 0:
            ratio = current.total_node_surface / baseline.total_node_surface
            if ratio > self.config.degrade_ratio:
                self.degrade_reasons.append(
                    f"节点包围盒总表面积膨胀 x{ratio:.2f}，refit 后大量冗余空间"
                )
        self.degraded = bool(self.degrade_reasons)

    def rebuild(self, config: BuildConfig | None = None) -> TreeStats:
        """质量恶化后的修复手段：用当前顶点重新建树。"""
        if config is not None:
            self.config = config
        self.build()
        return self.stats()

    # -------------------------------------------------------------- traversal
    def traverse(self, ray: Ray) -> dict:
        """沿射线遍历并返回最近命中，同时记录完整访问顺序。

        返回字典字段：
        hit            RayHit | None
        order          按访问顺序排列的节点记录
                       {node_id, depth, kind: 'box'|'tri'|'miss', t}
        nodes_tested   AABB 测试次数
        tris_tested    三角形测试次数
        内部节点按“近端子树优先”入栈，保证无需全量测试即可得到最近命中。
        """
        order: list[dict] = []
        nodes_tested = 0
        tris_tested = 0
        best: RayHit | None = None

        if self.root is None:
            return {
                "hit": None,
                "order": order,
                "nodes_tested": 0,
                "tris_tested": 0,
            }

        t_root = ray_aabb(ray, self.root.box)
        order.append({
            "node_id": self.root.id,
            "depth": 0,
            "kind": "miss" if t_root is None else "box",
            "t": t_root,
        })
        if t_root is None:
            return {
                "hit": None,
                "order": order,
                "nodes_tested": 1,
                "tris_tested": 0,
            }
        nodes_tested += 1
        stack: list[Node] = [self.root]

        while stack:
            node = stack.pop()
            if node.is_leaf:
                for tri_id in node.tri_ids:
                    tris_tested += 1
                    a, b, c = self.mesh.tri_points(tri_id)
                    hit = ray_triangle(ray, a, b, c)
                    if hit is None:
                        order.append({
                            "node_id": node.id,
                            "depth": node.depth,
                            "kind": "tri_miss",
                            "tri_id": tri_id,
                            "t": None,
                        })
                        continue
                    order.append({
                        "node_id": node.id,
                        "depth": node.depth,
                        "kind": "tri_hit",
                        "tri_id": tri_id,
                        "t": hit.t,
                    })
                    if best is None or hit.t < best.t:
                        best = RayHit(
                            tri_id=tri_id,
                            t=hit.t,
                            point=hit.point,
                            bary=hit.bary,
                        )
                continue

            t_left = ray_aabb(ray, node.left.box)
            t_right = ray_aabb(ray, node.right.box)
            nodes_tested += 2
            order.append({
                "node_id": node.left.id,
                "depth": node.left.depth,
                "kind": "miss" if t_left is None else "box",
                "t": t_left,
            })
            order.append({
                "node_id": node.right.id,
                "depth": node.right.depth,
                "kind": "miss" if t_right is None else "box",
                "t": t_right,
            })

            # 远端先压栈、近端后压栈，使近端子树优先弹出
            near_first = self._near_first(
                node.left, t_left, node.right, t_right, ray
            )
            for child, t_hit in reversed(near_first):
                if t_hit is not None:
                    stack.append(child)

        return {
            "hit": best,
            "order": order,
            "nodes_tested": nodes_tested,
            "tris_tested": tris_tested,
        }

    def pick(self, ray: Ray) -> RayHit | None:
        return self.traverse(ray)["hit"]

    @staticmethod
    def _near_first(left, t_left, right, t_right, ray: Ray):
        if t_left is None:
            return [(right, t_right)]
        if t_right is None:
            return [(left, t_left)]
        if t_left <= t_right:
            return [(left, t_left), (right, t_right)]
        return [(right, t_right), (left, t_left)]


def _volume(box: AABB) -> float:
    if box.is_empty() or any(v == inf for v in box.hi):
        return 0.0
    e = box.extents()
    return e[0] * e[1] * e[2]

