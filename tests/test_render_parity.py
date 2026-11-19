import unittest

from opaque_batcher import (
    FrameBuffer,
    MaterialRegistry,
    OpaqueBatcher,
    Scene,
    render_batched,
    render_per_object,
)
from opaque_batcher.mesh import MeshLibrary, make_cube
from opaque_batcher.renderer import compare_targets

WIDTH, HEIGHT = 96, 80
VIEW_SCALE = 12.0


def build_world():
    materials = MaterialRegistry()
    colors = (
        materials.create("red", (0.9, 0.2, 0.15)),
        materials.create("green", (0.2, 0.8, 0.3)),
        materials.create("blue", (0.2, 0.4, 0.95)),
    )
    scene = Scene()
    pick = 1
    for row in range(4):
        for col in range(4):
            z = 0.3 * ((row + col) % 3)
            scene.add("cube", colors[pick % 3],
                      ((col - 1.5) * 1.4, (row - 1.5) * 1.4, z),
                      scale=1.15)
            pick += 1
    meshes = MeshLibrary()
    meshes.add(make_cube())
    batcher = OpaqueBatcher(scene, materials)
    batcher.build()
    return scene, meshes, batcher, materials, colors


class RenderParityTests(unittest.TestCase):
    def _render(self, scene, meshes, batcher):
        reference = FrameBuffer(WIDTH, HEIGHT)
        batched = FrameBuffer(WIDTH, HEIGHT)
        stats_ref = render_per_object(reference, scene, meshes,
                                      batcher, VIEW_SCALE)
        stats_batch = render_batched(batched, meshes, batcher, VIEW_SCALE)
        return reference, batched, stats_ref, stats_batch

    def test_pixels_and_pick_ids_match_per_object_path(self):
        scene, meshes, batcher, _materials, _colors = build_world()
        reference, batched, stats_ref, stats_batch = self._render(
            scene, meshes, batcher)
        color_bad, pick_bad = compare_targets(reference, batched)
        self.assertEqual(color_bad, 0)
        self.assertEqual(pick_bad, 0)
        self.assertEqual(stats_ref.draw_calls, 16)
        self.assertEqual(stats_batch.draw_calls, 3)
        covered = {value for value in batched.pick if value}
        self.assertEqual(covered, set(range(1, 17)))

    def test_parity_after_local_material_migration(self):
        scene, meshes, batcher, materials, colors = build_world()
        scene.set_material(5, colors[2])
        batcher.replace_material(5)
        batcher.sync()
        reference, batched, _ref_stats, batch_stats = self._render(
            scene, meshes, batcher)
        color_bad, pick_bad = compare_targets(reference, batched)
        self.assertEqual((color_bad, pick_bad), (0, 0))
        self.assertEqual(batch_stats.draw_calls, 3)

    def test_parity_after_material_property_edit(self):
        scene, meshes, batcher, materials, colors = build_world()
        materials.set_color(colors[0], (0.6, 0.05, 0.8))
        batcher.mark_material_dirty(colors[0])
        batcher.sync()
        reference, batched, _ref_stats, _batch_stats = self._render(
            scene, meshes, batcher)
        color_bad, pick_bad = compare_targets(reference, batched)
        self.assertEqual((color_bad, pick_bad), (0, 0))

    def test_pick_query_returns_correct_object(self):
        scene, meshes, batcher, _materials, _colors = build_world()
        _, batched, _, _ = self._render(scene, meshes, batcher)
        covered = [idx for idx, value in enumerate(batched.pick) if value]
        self.assertTrue(covered)
        pick_at_center = batched.pick[covered[len(covered) // 2]]
        self.assertIn(pick_at_center, range(1, 17))
        instance = scene.get(pick_at_center)
        self.assertEqual(instance.pick_id, pick_at_center)


if __name__ == "__main__":
    unittest.main()
