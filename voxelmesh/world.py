"""分块体素世界：缓存分块网格，编辑后只重建受影响分块。"""

from __future__ import annotations

from dataclasses import dataclass, field

from .mesher import (
    face_metrics,
    greedy_chunk_mesh,
    naive_mesh,
    quad_unit_keys,
)


def _chunk_key(coord, size):
    return tuple(coord[a] // size[a] for a in range(3))


class Chunk:
    def __init__(self, key, origin, size):
        self.key = key
        self.origin = origin
        self.size = size
        self.voxels = {}
        self.quads = []
        self.dirty = True

    def get(self, x, y, z):
        return self.voxels.get((x, y, z), 0)

    def set(self, x, y, z, material):
        if material == 0:
            self.voxels.pop((x, y, z), None)
        else:
            self.voxels[(x, y, z)] = material

    @property
    def bounds(self):
        origin = self.origin
        hi = tuple(origin[a] + self.size[a] for a in range(3))
        return origin, hi


@dataclass
class DeleteResult:
    position: tuple
    existed: bool
    material: int
    invalidated: list
    rebuilt: list
    quads_before: int
    quads_after: int
    unit_before: int
    unit_after: int

    @property
    def quad_delta(self):
        return self.quads_after - self.quads_before

    @property
    def unit_delta(self):
        return self.unit_after - self.unit_before

    def summary(self):
        return (
            f"删除 {self.position}: 存在={self.existed} 材质={self.material}; "
            f"失效块 {sorted(self.invalidated)} 重建块 {len(self.rebuilt)}; "
            f"贪心面 {self.quads_before}->{self.quads_after} "
            f"(Δ{self.quad_delta:+d}); "
            f"单位面 {self.unit_before}->{self.unit_after} "
            f"(Δ{self.unit_delta:+d})"
        )


@dataclass
class _Snapshot:
    quad_count: int
    unit_count: int


class World:
    def __init__(self, chunk_size=(8, 8, 8)):
        self.chunk_size = tuple(chunk_size)
        self.chunks = {}
        self._dirty = set()

    # ---------- 基础访问 ----------

    def get_material(self, x, y, z):
        key = _chunk_key((x, y, z), self.chunk_size)
        chunk = self.chunks.get(key)
        return chunk.get(x, y, z) if chunk else 0

    def _chunk_for(self, coord):
        key = _chunk_key(coord, self.chunk_size)
        chunk = self.chunks.get(key)
        if chunk is None:
            size = self.chunk_size
            origin = tuple(key[a] * size[a] for a in range(3))
            chunk = Chunk(key, origin, size)
            self.chunks[key] = chunk
        return chunk

    def set_voxel(self, x, y, z, material):
        chunk = self._chunk_for((x, y, z))
        chunk.set(x, y, z, material)
        self._invalidate_around((x, y, z))

    def fill_box(self, lo, hi, material):
        for x in range(lo[0], hi[0]):
            for y in range(lo[1], hi[1]):
                for z in range(lo[2], hi[2]):
                    self._chunk_for((x, y, z)).set(x, y, z, material)
        # 盒式填充完成后统一失效一次，避免逐体素重复失效。
        touched = set()
        for x in range(lo[0], hi[0]):
            for y in range(lo[1], hi[1]):
                for z in range(lo[2], hi[2]):
                    touched.add(_chunk_key((x, y, z), self.chunk_size))
        for key in touched:
            self._invalidate_chunk_and_neighbors(key)

    # ---------- 失效 ----------

    def _invalidate_chunk_and_neighbors(self, key, coord=None):
        chunk = self.chunks.get(key)
        if chunk is not None:
            chunk.dirty = True
            self._dirty.add(key)
        # 只有编辑体素贴在某方向块面上时，该方向邻块才会受影响；
        # 块边界编辑时两侧都要失效，避免朝向本块的面保留旧结果。
        if coord is None:
            touch = {(axis, delta) for axis in range(3) for delta in (-1, 1)}
        else:
            size = self.chunk_size
            origin = chunk.origin if chunk is not None else tuple(
                key[a] * size[a] for a in range(3)
            )
            touch = set()
            for axis in range(3):
                local = coord[axis] - origin[axis]
                if local == 0:
                    touch.add((axis, -1))
                if local == size[axis] - 1:
                    touch.add((axis, +1))
        for axis in range(3):
            for delta in (-1, 1):
                if (axis, delta) not in touch:
                    continue
                neighbor_key = list(key)
                neighbor_key[axis] += delta
                neighbor_key = tuple(neighbor_key)
                neighbor = self.chunks.get(neighbor_key)
                if neighbor is not None:
                    neighbor.dirty = True
                    self._dirty.add(neighbor_key)

    def _invalidate_around(self, coord):
        key = _chunk_key(coord, self.chunk_size)
        self._invalidate_chunk_and_neighbors(key, coord)

    # ---------- 重建 ----------

    def rebuild_dirty(self):
        rebuilt = []
        for key in sorted(self._dirty):
            chunk = self.chunks.get(key)
            if chunk is None:
                continue
            chunk.quads = greedy_chunk_mesh(
                chunk.origin, chunk.size, self.get_material
            )
            chunk.dirty = False
            rebuilt.append(key)
        self._dirty.clear()
        return rebuilt

    def rebuild_all(self):
        self._dirty = set(self.chunks.keys())
        return self.rebuild_dirty()

    def all_quads(self):
        quads = []
        for key in sorted(self.chunks):
            quads.extend(self.chunks[key].quads)
        return quads

    def counts(self):
        quads = self.all_quads()
        return _Snapshot(
            quad_count=len(quads),
            unit_count=len(quad_unit_keys(quads)),
        )

    def metrics(self):
        return face_metrics(self.all_quads(), self.get_material)

    def world_bounds(self):
        if not self.chunks:
            return (0, 0, 0), (0, 0, 0)
        size = self.chunk_size
        keys = self.chunks.keys()
        lo = tuple(min(k[a] for k in keys) * size[a] for a in range(3))
        hi = tuple((max(k[a] for k in keys) + 1) * size[a] for a in range(3))
        return lo, hi

    # ---------- 编辑：删除 + 局部重建 ----------

    def delete_voxel(self, x, y, z):
        coord = (x, y, z)
        before = self.counts()
        chunk = self.chunks.get(_chunk_key(coord, self.chunk_size))
        material = chunk.get(x, y, z) if chunk else 0
        existed = material != 0
        invalidated = set()
        if existed:
            chunk.set(x, y, z, 0)
            key = _chunk_key(coord, self.chunk_size)
            self._invalidate_chunk_and_neighbors(key, coord)
            invalidated = set(self._dirty)
        rebuilt = self.rebuild_dirty()
        after = self.counts()
        return DeleteResult(
            position=coord,
            existed=existed,
            material=material,
            invalidated=sorted(invalidated),
            rebuilt=rebuilt,
            quads_before=before.quad_count,
            quads_after=after.quad_count,
            unit_before=before.unit_count,
            unit_after=after.unit_count,
        )

    # ---------- 参照对比 ----------

    def naive_reference_quads(self):
        """全量逐体素出面（参照实现）。"""
        lo, hi = self.world_bounds()
        return naive_mesh(self.get_material, (lo, hi))

    def verify_against_naive(self):
        """贪心网格展开后必须与逐体素参照的单位面集合完全一致。"""
        all_quads = self.all_quads()
        reference = quad_unit_keys(self.naive_reference_quads())
        actual = quad_unit_keys(all_quads)
        missing = reference - actual
        extra = actual - reference
        total_area = sum(quad.area for quad in all_quads)
        duplicate = len(actual) != total_area
        return {
            "matches": not missing and not extra and not duplicate,
            "reference_unit_faces": len(reference),
            "greedy_unit_faces": len(actual),
            "missing": sorted(missing),
            "extra": sorted(extra),
            "duplicate_internal_faces": duplicate,
        }
