"""三角网格 BVH 射线拾取器（纯标准库实现）。

模块划分：
- vec:   三维向量工具
- aabb:  轴对齐包围盒
- ray:   射线、ray-AABB / ray-triangle 求交、暴力参照
- bvh:   中位数切分与 SAH 建树、refit、质量度量、有序遍历
- mesh:  示例网格生成与形变
"""

from .aabb import AABB
from .bvh import BVH, BuildConfig, TreeStats
from .mesh import Mesh
from .ray import Ray, RayHit, ray_aabb, ray_triangle, brute_force_pick

__all__ = [
    "AABB",
    "BVH",
    "BuildConfig",
    "TreeStats",
    "Mesh",
    "Ray",
    "RayHit",
    "ray_aabb",
    "ray_triangle",
    "brute_force_pick",
]
