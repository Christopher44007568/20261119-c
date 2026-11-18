"""Decal system: owns decals, priority blending, removal restore and
receiver-deformation following.

Blending: decals overlapping the same receiver triangle are composited in
priority order (low first, highest last = on top). Each decal also gets a
unique layer offset so its patch geometry sorts correctly in depth.

Removal: a decal's patch is separate geometry, so deleting it locally
restores the receiver surface; the system reports which receiver triangles
were restored.

Deformation: patch vertices store (triangle id, barycentric) attachment, so
when the receiver mesh deforms slowly the patch is re-evaluated from the
attachment without a full re-projection.
"""

from .projector import project_decal
from .vec3 import barycentric, normalize

_LAYER_EPSILON = 1e-4


class DecalSystem:
    def __init__(self, mesh):
        self.mesh = mesh
        self._decals = {}       # id -> DecalDefinition
        self._patches = {}      # id -> DecalPatch
        self._reports = {}      # id -> ProjectionReport
        self._layer_extra = {}  # id -> currently applied layer offset
        self._coverage = {}     # receiver tri id -> [decal ids]
        self._next_id = 1

    def add_decal(self, decal):
        did = self._next_id
        self._next_id += 1
        patch, report = project_decal(self.mesh, decal)
        self._decals[did] = decal
        self._patches[did] = patch
        self._reports[did] = report
        self._layer_extra[did] = 0.0
        self._apply_layer_offsets()
        self._rebuild_coverage()
        return did

    def remove_decal(self, did):
        """Delete a decal; returns receiver triangle ids locally restored."""
        if did not in self._decals:
            return []
        restored = sorted(
            {v.tri_id for v in self._patches[did].vertices}
        )
        del self._decals[did]
        del self._patches[did]
        del self._reports[did]
        del self._layer_extra[did]
        self._apply_layer_offsets()
        self._rebuild_coverage()
        return restored

    def report(self, did):
        return self._reports[did]

    def patch(self, did):
        return self._patches[did]

    def decal_ids(self):
        return sorted(self._decals)

    def blend_stack(self, tri_id):
        """Decals covering a receiver triangle, sorted low->high priority."""
        ids = self._coverage.get(tri_id, [])
        return sorted(ids, key=lambda d: (self._decals[d].priority, d))

    def overlaps(self):
        """Receiver triangles covered by more than one decal."""
        return {t: self.blend_stack(t) for t, ids in self._coverage.items()
                if len(ids) > 1}

    def _apply_layer_offsets(self):
        order = sorted(self._decals, key=lambda d: (self._decals[d].priority, d))
        for layer, did in enumerate(order):
            target = layer * _LAYER_EPSILON
            delta = target - self._layer_extra[did]
            self._layer_extra[did] = target
            if delta == 0.0:
                continue
            for v in self._patches[did].vertices:
                v.position = (
                    v.position[0] + v.normal[0] * delta,
                    v.position[1] + v.normal[1] * delta,
                    v.position[2] + v.normal[2] * delta,
                )
                v.offset += delta

    def _rebuild_coverage(self):
        self._coverage = {}
        for did, patch in self._patches.items():
            for v in patch.vertices:
                self._coverage.setdefault(v.tri_id, set()).add(did)

    def deform_receiver(self, fn):
        """Deform the receiver mesh and re-attach all patches."""
        self.mesh.deform(fn)
        self.update()

    def update(self):
        """Re-evaluate patch vertices from their barycentric attachment."""
        mesh = self.mesh
        for did, patch in self._patches.items():
            decal = self._decals[did]
            for v in patch.vertices:
                tri = mesh.triangles[v.tri_id]
                pts = [mesh.vertices[i] for i in tri]
                nrms = [mesh.vertex_normal(i) for i in tri]
                pos = barycentric(v.bary, *pts)
                nrm = normalize(barycentric(v.bary, *nrms))
                v.normal = nrm
                v.position = (
                    pos[0] + nrm[0] * v.offset,
                    pos[1] + nrm[1] * v.offset,
                    pos[2] + nrm[2] * v.offset,
                )
