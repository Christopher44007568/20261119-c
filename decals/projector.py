"""Geometric decal projection: clip receiver triangles against an oriented
projection box and emit a local patch that hugs the receiving surface.

Depth and normal both take part in correction:
  * every patch vertex is pushed off the surface along the *receiver* normal
    by a constant normal bias plus a slope-scaled bias (grazing angles get a
    larger offset, like slope-scaled depth bias in shadow mapping);
  * the local depth inside the projection box is stored per vertex so the
    renderer can apply depth correction / fade near the box limits.

Backface protection: clipped fragments whose receiver normal faces away from
the projector are discarded, and the box depth range stops decals from
wrapping onto the far side of thin geometry.
"""

from dataclasses import dataclass, field

from .clip import clip_triangle_to_box
from .vec3 import barycentric, cross, dot, normalize, sub

_MAX_SLOPE = 10.0


@dataclass
class DecalDefinition:
    position: tuple
    direction: tuple
    half_extents: tuple = (0.5, 0.5, 0.5)
    texture: str = "decal"
    priority: int = 0
    normal_bias: float = 0.002
    slope_bias: float = 0.004
    min_normal_dot: float = 0.0
    max_stretch: float = 8.0

    def frame(self):
        ez = normalize(self.direction)
        up = (0.0, 0.0, 1.0)
        if abs(dot(ez, up)) > 0.99:
            up = (0.0, 1.0, 0.0)
        ex = normalize(cross(up, ez))
        ey = cross(ez, ex)
        return ex, ey, ez


@dataclass
class PatchVertex:
    position: tuple
    normal: tuple
    uv: tuple
    depth: float
    offset: float
    tri_id: int
    bary: tuple


@dataclass
class DecalPatch:
    decal: DecalDefinition
    vertices: list = field(default_factory=list)
    triangles: list = field(default_factory=list)


@dataclass
class ProjectionReport:
    triangles_tested: int = 0
    triangles_clipped: int = 0
    triangles_generated: int = 0
    backface_culled: int = 0
    stretch_culled: int = 0
    min_offset: float = 0.0
    max_offset: float = 0.0
    max_stretch: float = 0.0


def _slope_offset(decal, cos_angle):
    c = max(abs(cos_angle), 1e-3)
    slope = min(((1.0 - c * c) ** 0.5) / c, _MAX_SLOPE)
    return decal.normal_bias + decal.slope_bias * slope


def _tri_area(pa, pb, pc):
    ab = sub(pb, pa)
    ac = sub(pc, pa)
    c = (ab[1] * ac[2] - ab[2] * ac[1],
         ab[2] * ac[0] - ab[0] * ac[2],
         ab[0] * ac[1] - ab[1] * ac[0])
    return 0.5 * (c[0] ** 2 + c[1] ** 2 + c[2] ** 2) ** 0.5


def _stretch(world_pts, local_pts):
    """Area ratio between the surface fragment and its flat projection."""
    planar = _tri_area(
        (local_pts[0][0], local_pts[0][1], 0.0),
        (local_pts[1][0], local_pts[1][1], 0.0),
        (local_pts[2][0], local_pts[2][1], 0.0),
    )
    if planar < 1e-12:
        return float("inf")
    return _tri_area(*world_pts) / planar


def project_decal(mesh, decal):
    """Project one decal onto the mesh; returns (DecalPatch, ProjectionReport)."""
    ex, ey, ez = decal.frame()
    half = decal.half_extents
    origin = decal.position
    patch = DecalPatch(decal)
    report = ProjectionReport()
    offsets = []

    for ti, tri in enumerate(mesh.triangles):
        world = [mesh.vertices[i] for i in tri]
        local = []
        for p in world:
            d = sub(p, origin)
            local.append((dot(d, ex), dot(d, ey), dot(d, ez)))
        # Cheap reject: triangle AABB vs box in local space (all axes).
        if not all(
            min(p[a] for p in local) <= half[a]
            and max(p[a] for p in local) >= -half[a]
            for a in range(3)
        ):
            continue
        report.triangles_tested += 1

        bary_tri = [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]
        clipped = clip_triangle_to_box(local, bary_tri, half)
        if not clipped:
            continue
        report.triangles_clipped += 1

        vpos = [mesh.vertices[i] for i in tri]
        vnrm = [mesh.vertex_normal(i) for i in tri]

        for ctri in clipped:
            pts, barys, uvs, nrms = [], [], [], []
            for lp, bary in ctri:
                pos = barycentric(bary, *vpos)
                nrm = normalize(barycentric(bary, *vnrm))
                u = lp[0] / (2.0 * half[0]) + 0.5
                v = lp[1] / (2.0 * half[1]) + 0.5
                pts.append(pos)
                barys.append(bary)
                uvs.append((u, v))
                nrms.append(nrm)

            # Backface culling: receiver must face the projector.
            facing = dot(nrms[0], ez) + dot(nrms[1], ez) + dot(nrms[2], ez)
            if facing / 3.0 >= -decal.min_normal_dot:
                report.backface_culled += 1
                continue

            # Stretch metric: surface area vs flat-projection area.
            local_pts = [lp for lp, _ in ctri]
            if _tri_area(*pts) < 1e-12:
                continue  # degenerate sliver from box-boundary clipping
            stretch = _stretch(pts, local_pts)
            report.max_stretch = max(report.max_stretch, stretch)
            if stretch > decal.max_stretch:
                report.stretch_culled += 1
                continue

            base = len(patch.vertices)
            for k in range(3):
                cos_a = dot(nrms[k], ez)
                off = _slope_offset(decal, cos_a)
                offsets.append(off)
                lifted = (
                    pts[k][0] + nrms[k][0] * off,
                    pts[k][1] + nrms[k][1] * off,
                    pts[k][2] + nrms[k][2] * off,
                )
                depth = (ctri[k][0][2] + half[2]) / (2.0 * half[2])
                patch.vertices.append(
                    PatchVertex(lifted, nrms[k], uvs[k], depth, off, ti, barys[k])
                )
            patch.triangles.append((base, base + 1, base + 2))
            report.triangles_generated += 1

    if offsets:
        report.min_offset = min(offsets)
        report.max_offset = max(offsets)
    return patch, report
