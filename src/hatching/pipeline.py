"""End-to-end orchestration: mesh -> field -> hatching -> reports."""

from __future__ import annotations

import numpy as np

from . import analytics, shading, streamlines
from .curvature import estimate_curvature
from .field import build_fallback_field
from .mesh import make_mesh


def run_surface(name: str, seed: int = 11, verbose: bool = True):
    rng = np.random.default_rng(seed)
    mesh = make_mesh(name)
    curv = estimate_curvature(mesh)
    field_directions, field_source = build_fallback_field(mesh, curv)
    tone_v = shading.vertex_tone(mesh)
    tone_f = shading.face_tone(mesh, tone_v)

    all_lines = []
    layer_counts = []
    for layer in shading.LAYERS:
        points, faces, bary = shading.stratified_surface_samples(
            mesh, layer.spacing, rng)
        sample_tone = tone_f[faces]
        keep = layer.active(sample_tone)
        points, faces, bary = points[keep], faces[keep], bary[keep]
        lines = streamlines.trace_streamlines(
            mesh, curv, field_directions, points, faces, bary,
            layer.index, layer.spacing)
        all_lines.extend(lines)
        layer_counts.append(len(lines))
        if verbose:
            print(f"  layer {layer.index}: seeds={keep.sum()} "
                  f"lines={len(lines)}")

    mae, cmax = analytics.curvature_errors(mesh, curv)
    dmed, dp90, dmax, dmask = analytics.direction_errors(mesh, curv)
    stats = analytics.length_stats(all_lines)
    residual = analytics.attachment_residual(mesh, all_lines)
    breaks = [b for ln in all_lines for b in ln.breaks]
    summary = dict(
        surface=name,
        curvature_mae=round(mae, 6),
        curvature_max=round(cmax, 6),
        direction_median_deg=round(dmed, 4) if np.isfinite(dmed) else float("nan"),
        direction_p90_deg=round(dp90, 4) if np.isfinite(dp90) else float("nan"),
        direction_max_deg=round(dmax, 4) if np.isfinite(dmax) else float("nan"),
        confident_fraction=round(float(curv.confident.mean()), 4),
        fallback_fraction=round(float((~curv.confident).mean()), 4),
        n_vertices=mesh.n_vertices,
        n_faces=mesh.n_faces,
        n_streamlines=len(all_lines),
        length_stats=stats,
        attachment_residual_max=round(residual, 8),
        n_breaks=len(breaks),
        fallback_vertices=int((~curv.confident).sum()),
        singularity_vertices=0,
        layer_line_counts=layer_counts,
    )
    artifacts = dict(
        mesh=mesh, curv=curv, field_directions=field_directions,
        field_source=field_source, tone_v=tone_v, lines=all_lines,
        breaks=breaks, summary=summary,
    )
    return artifacts
