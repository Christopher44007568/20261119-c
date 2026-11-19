"""Opaque-instance material batch merging with incremental updates.

Opaque instances are merged into per-(mesh, material ID) batches. Material
IDs are stable integers, so an instance keeps its batch membership while
material *properties* change; only replacing an instance's material makes
that single instance migrate.

Each batch owns a packed instance buffer (analogous to a GPU vertex/SSBO)
and the registry owns a packed material constant buffer. Writes are tracked
as dirty slots and flushed with exact byte-range accounting via sync().
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

from .material import MaterialRegistry
from .scene import Instance, Scene

INSTANCE_STRIDE = 64
MATERIAL_STRIDE = 32
_INITIAL_CAPACITY = 4

_INSTANCE_HEAD = struct.Struct("<4d2I")
_MATERIAL_HEAD = struct.Struct("<4fI")


@dataclass
class _Batch:
    mesh_name: str
    material_id: int
    buffer: bytearray
    capacity: int
    size: int = 0
    pick_to_slot: dict[int, int] = field(default_factory=dict)
    dirty: set[int] = field(default_factory=set)


@dataclass
class UploadReport:
    instance_bytes: int = 0
    material_bytes: int = 0
    draw_calls: int = 0
    batch_count: int = 0
    instance_count: int = 0
    migrated: tuple[int, ...] = ()
    instance_ranges: tuple[tuple[str, int, int, int], ...] = ()
    material_ranges: tuple[tuple[int, int], ...] = ()

    @property
    def total_bytes(self) -> int:
        return self.instance_bytes + self.material_bytes


def _merged_bytes(dirty_slots: set[int], stride: int) -> tuple[int, list[tuple[int, int]]]:
    if not dirty_slots:
        return 0, []
    ranges: list[tuple[int, int]] = []
    start = prev = min(dirty_slots)
    for slot in sorted(dirty_slots):
        if slot > prev + 1:
            ranges.append((start, prev + 1))
            start = slot
        prev = slot
    ranges.append((start, prev + 1))
    total = sum((end - begin) * stride for begin, end in ranges)
    return total, ranges


def _pack_instance(buffer: bytearray, slot: int, instance: Instance) -> None:
    offset = slot * INSTANCE_STRIDE
    x, y, z = instance.position
    _INSTANCE_HEAD.pack_into(
        buffer, offset,
        x, y, z, instance.scale,
        instance.pick_id, instance.material_id,
    )


def unpack_instance(buffer: bytearray, slot: int) -> tuple[Instance, int]:
    """Read one packed slot back (the batched render path consumes this)."""
    offset = slot * INSTANCE_STRIDE
    x, y, z, scale, pick_id, material_id = _INSTANCE_HEAD.unpack_from(buffer, offset)
    return Instance(pick_id, "", material_id, (x, y, z), scale), offset


def _pack_material(buffer: bytearray, slot: int, material_id: int,
                   color: tuple[float, float, float]) -> None:
    offset = slot * MATERIAL_STRIDE
    _MATERIAL_HEAD.pack_into(
        buffer, offset,
        color[0], color[1], color[2], 0.0, material_id,
    )


class OpaqueBatcher:
    """Maintains opaque batches and incremental GPU-upload bookkeeping."""

    def __init__(self, scene: Scene, materials: MaterialRegistry) -> None:
        self.scene = scene
        self.materials = materials
        self._batches: dict[tuple[str, int], _Batch] = {}
        self._pick_batch: dict[int, _Batch] = {}
        self._material_buffer = bytearray()
        self._material_slots: dict[int, int] = {}
        self._material_dirty: set[int] = set()
        self._material_capacity = 0

    def _key(self, instance: Instance) -> tuple[str, int]:
        return instance.mesh_name, instance.material_id

    def _get_batch(self, instance: Instance) -> _Batch:
        key = self._key(instance)
        batch = self._batches.get(key)
        if batch is None:
            batch = _Batch(
                mesh_name=instance.mesh_name,
                material_id=instance.material_id,
                buffer=bytearray(_INITIAL_CAPACITY * INSTANCE_STRIDE),
                capacity=_INITIAL_CAPACITY,
            )
            self._batches[key] = batch
        return batch

    def _grow(self, batch: _Batch) -> None:
        new_capacity = batch.capacity * 2
        batch.buffer.extend(b"\x00" * (
            (new_capacity - batch.capacity) * INSTANCE_STRIDE))
        batch.capacity = new_capacity

    def _ensure_material_slot(self, material_id: int) -> int:
        slot = self._material_slots.get(material_id)
        if slot is not None:
            return slot
        slot = len(self._material_slots)
        if slot >= self._material_capacity:
            new_capacity = max(_INITIAL_CAPACITY,
                               self._material_capacity * 2)
            self._material_buffer.extend(b"\x00" * (
                (new_capacity - self._material_capacity) * MATERIAL_STRIDE))
            self._material_capacity = new_capacity
        self._material_slots[material_id] = slot
        self._material_dirty.add(material_id)
        return slot

    def add_instance(self, pick_id: int) -> None:
        instance = self.scene.get(pick_id)
        batch = self._get_batch(instance)
        if batch.size >= batch.capacity:
            self._grow(batch)
        slot = batch.size
        batch.size += 1
        batch.pick_to_slot[pick_id] = slot
        batch.dirty.add(slot)
        _pack_instance(batch.buffer, slot, instance)
        self._pick_batch[pick_id] = batch
        self._ensure_material_slot(instance.material_id)

    def remove_instance(self, pick_id: int) -> None:
        batch = self._pick_batch.pop(pick_id)
        slot = batch.pick_to_slot.pop(pick_id)
        last_slot = batch.size - 1
        if slot != last_slot:
            moved, _ = unpack_instance(batch.buffer, last_slot)
            batch.buffer[slot * INSTANCE_STRIDE:
                         (slot + 1) * INSTANCE_STRIDE] = (
                batch.buffer[last_slot * INSTANCE_STRIDE:
                             (last_slot + 1) * INSTANCE_STRIDE])
            batch.pick_to_slot[moved.pick_id] = slot
            self._pick_batch[moved.pick_id] = batch
            batch.dirty.discard(last_slot)
        batch.dirty.add(slot)
        batch.size -= 1
        if batch.size == 0:
            del self._batches[(batch.mesh_name, batch.material_id)]

    def replace_material(self, pick_id: int) -> None:
        """Migrate exactly one instance to the batch of its new material."""
        self.remove_instance(pick_id)
        self.add_instance(pick_id)
        self._ensure_material_slot(self.scene.get(pick_id).material_id)

    def mark_material_dirty(self, material_id: int) -> None:
        self._material_dirty.add(material_id)

    def draw_calls(self) -> int:
        return sum(1 for batch in self._batches.values() if batch.size)

    def batches(self) -> list[_Batch]:
        return sorted(self._batches.values(),
                      key=lambda b: (b.mesh_name, b.material_id))

    def material_slot(self, material_id: int) -> int:
        return self._material_slots[material_id]

    def material_color(self, material_id: int) -> tuple[float, float, float]:
        return self.materials.get(material_id).color

    def instance_count(self) -> int:
        return sum(batch.size for batch in self._batches.values())

    def build(self) -> UploadReport:
        """Merge every visible opaque instance and flush initial uploads."""
        for instance in self.scene.visible_instances():
            self.add_instance(instance.pick_id)
        return self.sync(migrated=())

    def _flush_materials(self) -> tuple[int, list[tuple[int, int]]]:
        for material_id in self.materials.take_dirty():
            self._material_dirty.add(material_id)
        dirty_slots = {self._material_slots[mid]
                       for mid in self._material_dirty
                       if mid in self._material_slots}
        total, slot_ranges = _merged_bytes(dirty_slots, MATERIAL_STRIDE)
        for material_id in self._material_dirty:
            slot = self._material_slots.get(material_id)
            if slot is None:
                continue
            material = self.materials.get(material_id)
            _pack_material(self._material_buffer, slot,
                           material_id, material.color)
        self._material_dirty.clear()
        byte_ranges = [(begin * MATERIAL_STRIDE, end * MATERIAL_STRIDE)
                       for begin, end in slot_ranges]
        return total, byte_ranges

    def sync(self, migrated: tuple[int, ...] = ()) -> UploadReport:
        """Flush all pending writes and return exact upload accounting.

        Instance writes are merged per batch into contiguous byte ranges;
        material constant writes are merged across the shared material
        buffer. Draw calls equal the number of non-empty opaque batches.
        """
        instance_bytes = 0
        instance_ranges: list[tuple[str, int, int, int]] = []
        for batch in self.batches():
            total, slot_ranges = _merged_bytes(batch.dirty, INSTANCE_STRIDE)
            instance_bytes += total
            for begin, end in slot_ranges:
                instance_ranges.append((
                    f"{batch.mesh_name}/mat{batch.material_id}",
                    begin * INSTANCE_STRIDE,
                    end * INSTANCE_STRIDE,
                    (end - begin) * INSTANCE_STRIDE,
                ))
            batch.dirty.clear()

        material_bytes, material_ranges = self._flush_materials()
        report = UploadReport(
            instance_bytes=instance_bytes,
            material_bytes=material_bytes,
            draw_calls=self.draw_calls(),
            batch_count=self.draw_calls(),
            instance_count=self.instance_count(),
            migrated=tuple(migrated),
            instance_ranges=tuple(instance_ranges),
            material_ranges=tuple(material_ranges),
        )
        return report

    def buffer_snapshot(self) -> dict[str, int]:
        """Resident buffer sizes after all flushes (for diagnostics)."""
        instance_bytes = sum(batch.capacity * INSTANCE_STRIDE
                             for batch in self._batches.values())
        return {
            "instance_buffer_bytes": instance_bytes,
            "material_buffer_bytes": self._material_capacity * MATERIAL_STRIDE,
        }
