import unittest

from opaque_batcher import (
    INSTANCE_STRIDE,
    MATERIAL_STRIDE,
    MaterialRegistry,
    OpaqueBatcher,
    Scene,
)
from opaque_batcher.batcher import unpack_instance


def build_scene():
    materials = MaterialRegistry()
    mat_a = materials.create("a", (1.0, 0.0, 0.0))
    mat_b = materials.create("b", (0.0, 1.0, 0.0))
    scene = Scene()
    first = scene.add("cube", mat_a, (0.0, 0.0, 0.0))
    second = scene.add("cube", mat_a, (1.0, 0.0, 0.0))
    third = scene.add("cube", mat_b, (2.0, 0.0, 0.0))
    return materials, scene, mat_a, mat_b, first, second, third


class MaterialTests(unittest.TestCase):
    def test_stable_monotonic_ids_never_reordered(self):
        registry = MaterialRegistry()
        first = registry.create("a", (1, 1, 1))
        second = registry.create("b", (0, 0, 0))
        self.assertEqual((first, second), (1, 2))
        registry.set_color(first, (0.5, 0.5, 0.5))
        self.assertEqual(registry.get(first).material_id, 1)
        self.assertEqual(registry.take_dirty(), {1, 2})
        self.assertEqual(registry.take_dirty(), set())


class BatcherTests(unittest.TestCase):
    def test_full_build_groups_by_stable_material_id(self):
        materials, scene, mat_a, mat_b, _, _, _ = build_scene()
        batcher = OpaqueBatcher(scene, materials)
        report = batcher.build()
        self.assertEqual(report.draw_calls, 2)
        self.assertEqual(report.instance_count, 3)
        self.assertEqual(report.instance_bytes, 3 * INSTANCE_STRIDE)
        self.assertEqual(report.material_bytes, 2 * MATERIAL_STRIDE)
        self.assertEqual(batcher.sync().total_bytes, 0)

    def test_local_material_change_migrates_only_one_instance(self):
        materials, scene, mat_a, mat_b, first, second, third = build_scene()
        batcher = OpaqueBatcher(scene, materials)
        batcher.build()
        batcher.sync()

        scene.set_material(second.pick_id, mat_b)
        batcher.replace_material(second.pick_id)
        report = batcher.sync(migrated=(second.pick_id,))

        batch_a = batcher.batches()[0]
        batch_b = batcher.batches()[1]
        self.assertEqual(batch_a.material_id, mat_a)
        self.assertEqual(batch_b.material_id, mat_b)
        self.assertEqual(batch_a.size, 1)
        self.assertEqual(batch_b.size, 2)
        packed, _ = unpack_instance(batch_b.buffer, 0)
        packed2, _ = unpack_instance(batch_b.buffer, 1)
        pick_ids = {packed.pick_id, packed2.pick_id}
        self.assertEqual(pick_ids, {second.pick_id, third.pick_id})
        self.assertEqual(report.migrated, (second.pick_id,))
        self.assertEqual(report.instance_bytes, 2 * INSTANCE_STRIDE)
        self.assertEqual(batcher.draw_calls(), 2)

    def test_material_property_edit_uploads_one_constant_only(self):
        materials, scene, mat_a, mat_b, *_ = build_scene()
        batcher = OpaqueBatcher(scene, materials)
        batcher.build()
        batcher.sync()

        materials.set_color(mat_a, (0.1, 0.2, 0.3))
        batcher.mark_material_dirty(mat_a)
        report = batcher.sync()
        self.assertEqual(report.instance_bytes, 0)
        self.assertEqual(report.material_bytes, MATERIAL_STRIDE)

    def test_contiguous_dirty_slots_merge_into_one_range(self):
        materials, scene, mat_a, mat_b, first, second, third = build_scene()
        extra = scene.add("cube", mat_a, (3.0, 0.0, 0.0))
        batcher = OpaqueBatcher(scene, materials)
        batcher.build()
        batcher.sync()
        # mat_a batch holds pick 1,2,4 at slots 0,1,2. Removing the middle
        # slot marks only slot 1 dirty (one contiguous range, one slot).
        batcher.remove_instance(second.pick_id)
        report = batcher.sync()
        mat_a_ranges = [r for r in report.instance_ranges
                        if r[0] == f"cube/mat{mat_a}"]
        self.assertEqual(len(mat_a_ranges), 1)
        self.assertEqual(mat_a_ranges[0][3], INSTANCE_STRIDE)
        self.assertEqual(report.instance_bytes, INSTANCE_STRIDE)

    def test_migration_touches_source_and_destination_batches(self):
        materials, scene, mat_a, mat_b, first, second, third = build_scene()
        batcher = OpaqueBatcher(scene, materials)
        batcher.build()
        batcher.sync()
        scene.set_material(first.pick_id, mat_b)
        batcher.replace_material(first.pick_id)
        report = batcher.sync()
        self.assertEqual(len(report.instance_ranges), 2)
        self.assertEqual(report.instance_bytes, 2 * INSTANCE_STRIDE)

    def test_removal_empties_and_drops_batch(self):
        materials, scene, mat_a, mat_b, first, second, third = build_scene()
        batcher = OpaqueBatcher(scene, materials)
        batcher.build()
        batcher.remove_instance(third.pick_id)
        scene.remove(third.pick_id)
        self.assertEqual(batcher.draw_calls(), 1)
        remaining = batcher.batches()[0]
        self.assertEqual(remaining.size, 2)

    def test_pick_ids_survive_packing(self):
        materials, scene, *_ = build_scene()
        batcher = OpaqueBatcher(scene, materials)
        batcher.build()
        seen = set()
        for batch in batcher.batches():
            for slot in range(batch.size):
                packed, _ = unpack_instance(batch.buffer, slot)
                seen.add(packed.pick_id)
        self.assertEqual(seen, {1, 2, 3})


if __name__ == "__main__":
    unittest.main()
