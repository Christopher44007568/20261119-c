"""贪心网格化与逐体素参照实现。

约定：材质 0 表示空气。两个相邻实体体素材质不同时，保留材质分界面
（各自出一个朝向相反的面）；材质相同时该面为内部面，整体剔除。

每个面都由“实体体素”一侧的分块拥有，因此分块边界上的面只会由
一个分块产出，天然不会出现重复面。
"""

from __future__ import annotations

from dataclasses import dataclass

# 6 个朝向：d=0..2 为正轴方向，d=3..5 为负轴方向。
DIRS = (
    (0, (1, 0, 0)),
    (1, (0, 1, 0)),
    (2, (0, 0, 1)),
    (0, (-1, 0, 0)),
    (1, (0, -1, 0)),
    (2, (0, 0, -1)),
)

_AXES = ((1, 2), (0, 2), (0, 1))


@dataclass(frozen=True)
class Quad:
    """一个矩形面（贪心合并后的面或逐体素单位面）。"""

    axis: int          # 面法线所在轴 0/1/2
    sign: int          # +1 或 -1
    base: tuple        # 面所在角点的世界坐标 (x, y, z)
    dims: tuple        # 在另外两个轴上的尺寸（单位面为 (1, 1)）
    material: int

    @property
    def area(self) -> int:
        return self.dims[0] * self.dims[1]

    def unit_keys(self) -> frozenset:
        """展开为它覆盖的全部单位面 key: (owner_voxel, dir_index)。"""
        u_axis, v_axis = _AXES[self.axis]
        keys = set()
        for u in range(self.dims[0]):
            for v in range(self.dims[1]):
                point = [0, 0, 0]
                # 正向面 base 在高侧平面，owner 需减 1；负向面 base 即 owner 坐标。
                point[self.axis] = self.base[self.axis] + (-1 if self.sign > 0 else 0)
                point[u_axis] = self.base[u_axis] + u
                point[v_axis] = self.base[v_axis] + v
                if self.sign > 0:
                    owner = tuple(point)
                    dir_index = self.axis  # DIRS 中 +x/+y/+z 的位置索引即轴号
                else:
                    owner = tuple(point)
                    dir_index = self.axis + 3
                keys.add((owner, dir_index))
        return frozenset(keys)


def _merge_mask(mask, size_u, size_v, emit):
    """对单层掩码做标准贪心矩形合并，对每个矩形回调 emit。"""
    done = [[False] * size_v for _ in range(size_u)]
    for u in range(size_u):
        for v in range(size_v):
            if done[u][v] or mask[u][v] == 0:
                continue
            material = mask[u][v]
            width = 1
            while u + width < size_u and mask[u + width][v] == material and not done[u + width][v]:
                width += 1
            height = 1
            while v + height < size_v:
                ok = True
                for du in range(width):
                    if mask[u + du][v + height] != material or done[u + du][v + height]:
                        ok = False
                        break
                if not ok:
                    break
                height += 1
            for du in range(width):
                for dv in range(height):
                    done[u + du][v + dv] = True
            emit(u, v, width, height, material)


def greedy_chunk_mesh(chunk_origin, chunk_size, get_material, owns=None):
    """对一个分块做贪心网格化。

    chunk_origin: 分块最小角世界坐标。
    get_material(x, y, z) -> int：可查询分块内外任意体素材质（0=空气）。
    owns(x, y, z) -> bool：判定某实体体素是否归本分块拥有，默认按坐标
    落在分块内判定。只有被本分块拥有的体素才产出面，保证跨块不重复。
    """
    if owns is None:
        def owns(x, y, z):
            return all(chunk_origin[a] <= c < chunk_origin[a] + chunk_size[a]
                       for a, c in enumerate((x, y, z)))

    quads = []
    size = chunk_size
    for axis in range(3):
        u_axis, v_axis = _AXES[axis]
        planes = size[axis] + 1
        for plane in range(planes):
            masks = {+1: [[0] * size[v_axis] for _ in range(size[u_axis])],
                     -1: [[0] * size[v_axis] for _ in range(size[u_axis])]}
            for iu in range(size[u_axis]):
                for iv in range(size[v_axis]):
                    coord = [0, 0, 0]
                    coord[u_axis] = chunk_origin[u_axis] + iu
                    coord[v_axis] = chunk_origin[v_axis] + iv
                    coord[axis] = chunk_origin[axis] + plane
                    nxt = list(coord)
                    cur = list(coord)
                    cur[axis] -= 1
                    m_next = get_material(*nxt)
                    m_cur = get_material(*cur)
                    # 正轴向面：体素在平面负侧，邻居在正侧。
                    if m_cur != 0 and m_next != m_cur and owns(*cur):
                        masks[+1][iu][iv] = m_cur
                    # 负轴向面：体素在平面正侧，邻居在负侧。
                    if m_next != 0 and m_cur != m_next and owns(*nxt):
                        masks[-1][iu][iv] = m_next

            for sign in (+1, -1):
                def emit(u, v, w, h, material, sign=sign, plane=plane):
                    base = [0, 0, 0]
                    # 正向面 base 取高侧平面(owner 在 plane-1)；
                    # 负向面 base 取 owner 体素坐标（即 plane 处）。
                    base[axis] = chunk_origin[axis] + plane
                    base[u_axis] = chunk_origin[u_axis] + u
                    base[v_axis] = chunk_origin[v_axis] + v
                    quads.append(
                        Quad(axis, sign, tuple(base), (w, h), material)
                    )

                _merge_mask(masks[sign], size[u_axis], size[v_axis], emit)
    return quads


def naive_mesh(get_material, bounds):
    """逐体素出参照面。bounds=(lo, hi) 为包含 lo、不包含 hi 的世界范围。"""
    lo, hi = bounds
    quads = []
    for x in range(lo[0], hi[0]):
        for y in range(lo[1], hi[1]):
            for z in range(lo[2], hi[2]):
                material = get_material(x, y, z)
                if material == 0:
                    continue
                for axis, normal in DIRS:
                    neighbor = [x, y, z]
                    neighbor[axis] += normal[axis]
                    neighbor_material = get_material(*neighbor)
                    if neighbor_material == material:
                        continue  # 内部面：同材质，剔除
                    u_axis, v_axis = _AXES[axis]
                    base = [0, 0, 0]
                    owner_coord = (x, y, z)
                    base[axis] = owner_coord[axis] + (1 if normal[axis] > 0 else 0)
                    base[u_axis] = owner_coord[u_axis]
                    base[v_axis] = owner_coord[v_axis]
                    sign = 1 if normal[axis] > 0 else -1
                    quad = Quad(axis, sign, tuple(base), (1, 1), material)
                    quads.append(quad)
    return quads


def quad_unit_keys(quads):
    """多个 Quad 覆盖的单位面 key 集合。"""
    keys = set()
    for quad in quads:
        keys.update(quad.unit_keys())
    return frozenset(keys)


def face_metrics(quads, get_material):
    """统计指标：单位面总数、外表面积、材质分界面数（均按单位面计）。

    外表面 = 与空气相邻的面；材质分界面 = 两侧均为实体但材质不同的面，
    每个几何界面两侧各计一个面。区分依据是邻居体素材质而非面朝向。
    """
    external = 0
    boundary = 0
    for quad in quads:
        for owner, dir_index in quad.unit_keys():
            axis, normal = DIRS[dir_index]  # 位置索引 0..5
            neighbor = list(owner)
            neighbor[axis] += normal[axis]
            if get_material(*neighbor) == 0:
                external += 1
            else:
                boundary += 1
    total = external + boundary
    return {"unit_faces": total, "external": external, "boundary": boundary}
