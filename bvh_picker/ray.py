"""射线定义与求交原语，以及暴力求交参照。"""

from __future__ import annotations

from dataclasses import dataclass
from math import inf

from .aabb import AABB
from .vec import Vec3, cross, dot, sub

# 通用数值容差：小于该距离的命中视为自交/数值噪声
EPS_T = 1e-9
EPS_D = 1e-12


@dataclass(frozen=True)
class Ray:
    origin: Vec3
    direction: Vec3  # 已归一化
    tmax: float = inf

    @classmethod
    def make(cls, origin: Vec3, direction: Vec3, tmax: float = inf) -> "Ray":
        from .vec import normalize

        return cls(tuple(origin), normalize(direction), tmax)

    def at(self, t: float) -> Vec3:
        return tuple(self.origin[i] + t * self.direction[i] for i in range(3))


@dataclass(frozen=True)
class RayHit:
    """一次三角形命中。

    tri_id  三角形索引
    t       射线参数（命中点 = origin + t * dir）
    point   命中点
    bary    重心坐标 (u, v)，对应 (1-u-v, u, v)
    """

    tri_id: int
    t: float
    point: Vec3
    bary: tuple[float, float]


def ray_aabb(ray: Ray, box: AABB, tmin: float = EPS_T) -> float | None:
    """slab 法。返回进入参数 t（保证 t >= tmin），未命中返回 None。

    返回的是进入距离而非出口距离；调用方只需判断“是否相交”。
    对零分量方向用 ±inf 倒数处理，平行于某条 slab 时自然失效。
    """
    t_lo = tmin
    t_hi = ray.tmax
    for i in range(3):
        d = ray.direction[i]
        o = ray.origin[i]
        if abs(d) < EPS_D:
            if o < box.lo[i] - EPS_D or o > box.hi[i] + EPS_D:
                return None
            continue
        inv = 1.0 / d
        t1 = (box.lo[i] - o) * inv
        t2 = (box.hi[i] - o) * inv
        if t1 > t2:
            t1, t2 = t2, t1
        t_lo = max(t_lo, t1)
        t_hi = min(t_hi, t2)
        if t_lo > t_hi + EPS_D:
            return None
    return t_lo


def ray_triangle(
    ray: Ray,
    v0: Vec3,
    v1: Vec3,
    v2: Vec3,
) -> RayHit | None:
    """Möller–Trumbore 求交，返回带重心坐标的命中，未命中返回 None。

    - 平行/背面由行列式与容差判定；
    - t < EPS_T 的命中被剔除，避免从表面出发时的自交；
    - 重心坐标允许小幅越界（误差内的擦边命中）。
    """
    edge1 = sub(v1, v0)
    edge2 = sub(v2, v0)
    pvec = cross(ray.direction, edge2)
    det = dot(edge1, pvec)
    if abs(det) < EPS_D:
        return None  # 射线与三角形平面平行

    inv_det = 1.0 / det
    tvec = sub(ray.origin, v0)
    u = dot(tvec, pvec) * inv_det
    if u < -EPS_D or u > 1.0 + EPS_D:
        return None

    qvec = cross(tvec, edge1)
    v = dot(ray.direction, qvec) * inv_det
    if v < -EPS_D or (u + v) > 1.0 + EPS_D:
        return None

    t = dot(edge2, qvec) * inv_det
    if t < EPS_T or t > ray.tmax:
        return None

    u = min(max(u, 0.0), 1.0)
    v = min(max(v, 0.0), 1.0)
    return RayHit(
        tri_id=-1,
        t=t,
        point=ray.at(t),
        bary=(u, v),
    )


def brute_force_pick(mesh, ray: Ray) -> RayHit | None:
    """遍历全部三角形求最近命中，作为正确性参照。"""
    best: RayHit | None = None
    for tri_id, (a, b, c) in enumerate(mesh.triangles):
        hit = ray_triangle(ray, mesh.vertices[a], mesh.vertices[b], mesh.vertices[c])
        if hit is not None and (best is None or hit.t < best.t):
            best = RayHit(
                tri_id=tri_id,
                t=hit.t,
                point=hit.point,
                bary=hit.bary,
            )
    return best
