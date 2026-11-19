"""End-to-end demonstration and acceptance run.

Scenarios:
  1. Full build: merge opaque instances by stable material ID.
  2. Per-object vs batched rendering must produce identical color/pick
     pixels, while draw calls drop from one-per-object to one-per-batch.
  3. Local material replacement migrates only the affected instance and
     uploads only the touched instance-buffer slots.
  4. Material property edits upload only the 32-byte material constant.
"""

from __future__ import annotations

import os

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

WIDTH, HEIGHT = 160, 120
VIEW_SCALE = 14.0


def write_ppm(path: str, fb: FrameBuffer) -> None:
    with open(path, "wb") as handle:
        header = f"P6\n{fb.width} {fb.height}\n255\n".encode()
        handle.write(header)
        handle.write(bytes(fb.color))


def write_pick_ppm(path: str, fb: FrameBuffer) -> None:
    palette = bytearray(fb.width * fb.height * 3)
    for idx, pick_id in enumerate(fb.pick):
        if pick_id:
            off = idx * 3
            palette[off] = (pick_id * 53) & 0xFF
            palette[off + 1] = (pick_id * 97) & 0xFF
            palette[off + 2] = (pick_id * 193) & 0xFF
    with open(path, "wb") as handle:
        handle.write(f"P6\n{fb.width} {fb.height}\n255\n".encode())
        handle.write(bytes(palette))


def render_pair(scene, meshes, batcher):
    reference = FrameBuffer(WIDTH, HEIGHT)
    batched = FrameBuffer(WIDTH, HEIGHT)
    stats_ref = render_per_object(reference, scene, meshes, batcher, VIEW_SCALE)
    stats_batch = render_batched(batched, meshes, batcher, VIEW_SCALE)
    color_bad, pick_bad = compare_targets(reference, batched)
    return reference, batched, stats_ref, stats_batch, color_bad, pick_bad


def print_report(title, report):
    print(f"\n[{title}]")
    print(f"  upload total      : {report.total_bytes} bytes "
          f"(instance {report.instance_bytes} + material {report.material_bytes})")
    for label, begin, end, size in report.instance_ranges:
        print(f"    instance range  {label} [{begin:>4},{end:>4}) = {size} B")
    for begin, end in report.material_ranges:
        print(f"    material range  [{begin:>4},{end:>4}) = {end - begin} B")
    print(f"  draw calls/batches: {report.draw_calls}")
    if report.migrated:
        print(f"  migrated pick IDs : {list(report.migrated)}")


def main() -> int:
    materials = MaterialRegistry()
    red = materials.create("red", (0.90, 0.18, 0.16))
    green = materials.create("green", (0.20, 0.78, 0.30))
    blue = materials.create("blue", (0.20, 0.42, 0.95))
    yellow = materials.create("yellow", (0.95, 0.82, 0.20))
    mat_cycle = (red, green, blue, yellow)

    scene = Scene()
    for row in range(6):
        for col in range(6):
            material_id = mat_cycle[(row * 6 + col) % 4]
            z = 0.25 * ((row + col) % 3)
            scene.add("cube", material_id,
                      ((col - 2.5) * 1.5, (row - 2.5) * 1.5, z),
                      scale=1.2)

    meshes = MeshLibrary()
    meshes.add(make_cube())
    batcher = OpaqueBatcher(scene, materials)

    print("== Opaque material batching demo ==")
    full = batcher.build()
    print_report("full build", full)

    ref, batched_fb, stats_ref, stats_batch, color_bad, pick_bad = render_pair(
        scene, meshes, batcher)
    print("\n[render]")
    print(f"  per-object draw calls : {stats_ref.draw_calls}")
    print(f"  batched draw calls    : {stats_batch.draw_calls}")
    print(f"  color pixel mismatches: {color_bad}")
    print(f"  pick  pixel mismatches: {pick_bad}")
    covered = {pick_id for pick_id in batched_fb.pick if pick_id}
    print(f"  distinct pick IDs hit : {len(covered)} / 36")

    os.makedirs("artifacts", exist_ok=True)
    write_ppm("artifacts/frame_batched.ppm", batched_fb)
    write_pick_ppm("artifacts/pick_ids.ppm", batched_fb)

    target_pick = 7
    scene.set_material(target_pick, yellow)
    batcher.replace_material(target_pick)
    migrate_report = batcher.sync(migrated=(target_pick,))
    print_report("local material replacement (pick 7 -> yellow)",
                 migrate_report)
    _, _, _, _, color_bad2, pick_bad2 = render_pair(scene, meshes, batcher)
    print(f"  re-render mismatches : color {color_bad2}, pick {pick_bad2}")

    materials.set_color(green, (0.10, 0.95, 0.55))
    batcher.mark_material_dirty(green)
    prop_report = batcher.sync()
    print_report("material property edit (green recolored)", prop_report)
    _, _, _, _, color_bad3, pick_bad3 = render_pair(scene, meshes, batcher)
    print(f"  re-render mismatches : color {color_bad3}, pick {pick_bad3}")

    idle_report = batcher.sync()
    print_report("idle sync (no pending changes)", idle_report)

    ok = (
        color_bad == 0 and pick_bad == 0
        and color_bad2 == 0 and pick_bad2 == 0
        and color_bad3 == 0 and pick_bad3 == 0
        and stats_ref.draw_calls == 36
        and stats_batch.draw_calls == 4
        and len(covered) == 36
        and migrate_report.total_bytes == 128
        and prop_report.instance_bytes == 0
        and prop_report.material_bytes == 32
        and idle_report.total_bytes == 0
    )
    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
