"""Demo: bullet holes, water stains and markers on an undulating surface."""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from decals import DecalDefinition, DecalSystem, TriangleMesh


def main():
    mesh = TriangleMesh.grid(
        24, 24, 4.0,
        height_fn=lambda x, y: 0.3 * math.sin(2.0 * x) * math.cos(2.0 * y),
    )
    system = DecalSystem(mesh)

    bullet = system.add_decal(DecalDefinition(
        position=(0.3, 0.2, 1.0), direction=(0.1, 0.0, -1.0),
        half_extents=(0.15, 0.15, 1.0), texture="bullet_hole", priority=10,
    ))
    stain = system.add_decal(DecalDefinition(
        position=(0.25, 0.15, 1.0), direction=(0.0, 0.0, -1.0),
        half_extents=(0.6, 0.6, 1.0), texture="water_stain", priority=1,
    ))
    marker = system.add_decal(DecalDefinition(
        position=(-1.0, -1.0, 1.0), direction=(0.3, 0.2, -1.0),
        half_extents=(0.25, 0.25, 1.0), texture="marker", priority=5,
    ))

    for did in system.decal_ids():
        r = system.report(did)
        tex = system.patch(did).decal.texture
        print(f"[{tex}] clipped={r.triangles_clipped} "
              f"generated={r.triangles_generated} "
              f"backface_culled={r.backface_culled} "
              f"stretch_culled={r.stretch_culled} "
              f"max_stretch={r.max_stretch:.3f} "
              f"offset=[{r.min_offset:.4f},{r.max_offset:.4f}]")

    overlaps = system.overlaps()
    print(f"overlap triangles: {len(overlaps)}")
    for tri, stack in list(overlaps.items())[:3]:
        names = [system.patch(d).decal.texture for d in stack]
        print(f"  tri {tri}: blend order {' -> '.join(names)}")

    restored = system.remove_decal(stain)
    print(f"removed water_stain, restored {len(restored)} receiver triangles")

    system.deform_receiver(
        lambda i, p: (p[0], p[1], p[2] + 0.05 * math.sin(p[0] + p[1]))
    )
    patch = system.patch(bullet)
    z = patch.vertices[0].position[2]
    print(f"after deform: bullet patch vertex0 z={z:.4f} (follows surface)")


if __name__ == "__main__":
    main()
