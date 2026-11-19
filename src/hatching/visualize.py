"""3D visualisations of the hatching pipeline (matplotlib, object space)."""

from __future__ import annotations

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import numpy as np

from . import shading

VIEWS = ((-55, 22), (10, 22), (75, 8))
SURFACE_COLOR = "#c7d6e5"
SURFACE_EDGE = "#9fb4c8"
HATCH_COLOR = "#22303c"
FIELD_COLOR = "#c0392b"
BREAK_COLORS = {"boundary": "#c0392b", "umbilic": "#7d3c98",
                 "length": "#7f8c8d"}


def _surface_kwargs(alpha=0.55):
    return dict(color=SURFACE_COLOR, edgecolor=SURFACE_EDGE,
                linewidth=0.15, alpha=alpha)


def _equal_3d(ax, mesh):
    pts = mesh.vertices
    center = pts.mean(axis=0)
    radius = float(np.ptp(pts, axis=0).max()) / 2
    ax.set_xlim(center[0] - radius, center[0] + radius)
    ax.set_ylim(center[1] - radius, center[1] + radius)
    ax.set_zlim(center[2] - radius, center[2] + radius)
    try:
        ax.set_box_aspect((1, 1, 1))
    except AttributeError:
        pass


def _draw_surface(ax, mesh, alpha=0.55):
    ax.plot_trisurf(mesh.vertices[:, 0], mesh.vertices[:, 1],
                    mesh.vertices[:, 2], triangles=mesh.faces,
                    **_surface_kwargs(alpha))


def _draw_lines(ax, lines, linewidth=0.7):
    for line in lines:
        ax.plot(line.points[:, 0], line.points[:, 1], line.points[:, 2],
                color=HATCH_COLOR, linewidth=linewidth, solid_capstyle="butt")


def plot_hatching_views(mesh, lines, path):
    fig = plt.figure(figsize=(22.5, 6.9))
    light = ", ".join(f"{v:g}" for v in shading.LIGHT)
    fig.suptitle(f"{mesh.name}: surface-attached hatching "
                 f"(fixed object-space light [{light}])", fontsize=17)
    for idx, (azim, elev) in enumerate(VIEWS, start=1):
        ax = fig.add_subplot(1, 3, idx, projection="3d")
        _draw_surface(ax, mesh)
        _draw_lines(ax, lines)
        ax.view_init(elev=elev, azim=azim)
        ax.set_title(f"azim {azim}°, elev {elev}°", fontsize=15)
        _equal_3d(ax, mesh)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(path, dpi=100)
    plt.close(fig)


def plot_direction_field(mesh, curv, field_directions, field_source, path):
    fig = plt.figure(figsize=(12, 10.5))
    ax = fig.add_subplot(111, projection="3d")
    _draw_surface(ax, mesh, alpha=0.45)
    step = max(1, mesh.n_vertices // 220)
    idxs = np.arange(0, mesh.n_vertices, step)
    scale = 2.2 * mesh.mean_edge
    for i in idxs:
        origin = mesh.vertices[i] + mesh.normals[i] * (0.15 * mesh.mean_edge)
        vec = field_directions[i] * scale
        confident = bool(curv.confident[i])
        color = FIELD_COLOR if confident else "#7f8c8d"
        ax.quiver(origin[0], origin[1], origin[2], vec[0], vec[1], vec[2],
                  color=color, linewidth=1.3, arrow_length_ratio=0.35)
    handles = [
        plt.Line2D([0], [0], color=FIELD_COLOR, lw=2, label="principal (d2)"),
        plt.Line2D([0], [0], color="#7f8c8d", lw=2,
                   label="fallback (parallel transport)"),
    ]
    ax.legend(handles=handles, fontsize=12)
    ax.set_title(f"{mesh.name}: principal direction field", fontsize=17)
    ax.view_init(elev=22, azim=-55)
    _equal_3d(ax, mesh)
    fig.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)


def _tangent_patch(mesh, vertex_id, half):
    normal = mesh.normals[vertex_id]
    helper = np.array([1.0, 0.0, 0.0])
    if abs(normal @ helper) > 0.9:
        helper = np.array([0.0, 1.0, 0.0])
    e1 = helper - normal * (helper @ normal)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(normal, e1)
    center = mesh.vertices[vertex_id]
    corners = [center - half * e1 - half * e2,
               center + half * e1 - half * e2,
               center + half * e1 + half * e2,
               center - half * e1 + half * e2]
    return np.asarray(corners)


def plot_tangent_planes(mesh, curv, field_directions, path):
    fig = plt.figure(figsize=(12, 10.5))
    ax = fig.add_subplot(111, projection="3d")
    _draw_surface(ax, mesh, alpha=0.35)
    rng = np.random.default_rng(3)
    chosen = rng.choice(mesh.n_vertices, size=6, replace=False)
    half = 2.6 * mesh.mean_edge
    for vid in chosen:
        quad = _tangent_patch(mesh, int(vid), half)
        ax.add_collection3d(Poly3DCollection(
            [quad], facecolor="#d6e4f2", edgecolor="#2471a3",
            linewidth=1.2, alpha=0.75))
        origin = mesh.vertices[int(vid)]
        vec = field_directions[int(vid)] * half
        ax.plot([origin[0] - vec[0], origin[0] + vec[0]],
                [origin[1] - vec[1], origin[1] + vec[1]],
                [origin[2] - vec[2], origin[2] + vec[2]],
                color="#c0392b", linewidth=2.0)
    ax.set_title(f"{mesh.name}: local tangent planes and direction",
                 fontsize=17)
    ax.view_init(elev=22, azim=-55)
    _equal_3d(ax, mesh)
    fig.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)


def plot_breaks(mesh, lines, breaks, path):
    fig = plt.figure(figsize=(12, 10.5))
    ax = fig.add_subplot(111, projection="3d")
    _draw_surface(ax, mesh, alpha=0.4)
    for line in lines:
        ax.plot(line.points[:, 0], line.points[:, 1], line.points[:, 2],
                color="#5d6d7e", linewidth=0.35, alpha=0.55)
    reasons = sorted({b["reason"] for b in breaks})
    for reason in reasons:
        pts = np.asarray([b["xyz"] for b in breaks if b["reason"] == reason])
        ax.scatter(pts[:, 0], pts[:, 1], pts[:, 2],
                   c=BREAK_COLORS.get(reason, "#333333"), s=18,
                   depthshade=False, label=reason)
    ax.legend(fontsize=13)
    ax.set_title(f"{mesh.name}: streamline break positions", fontsize=17)
    ax.view_init(elev=22, azim=-55)
    _equal_3d(ax, mesh)
    fig.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)


def plot_length_histogram(surface_name, lines, path):
    lengths = np.asarray([ln.arc_length for ln in lines])
    fig, ax = plt.subplots(figsize=(12, 7.2))
    bins = min(40, max(10, int(np.sqrt(len(lengths)))))
    ax.hist(lengths, bins=bins, color="#4393c3", edgecolor="white")
    median = float(np.median(lengths))
    mean = float(np.mean(lengths))
    ax.axvline(median, color="#c0392b", linestyle="--", linewidth=2.2,
               label=f"median {median:.3f}")
    ax.axvline(mean, color="#1e8449", linestyle=":", linewidth=2.2,
               label=f"mean {mean:.3f}")
    ax.legend(fontsize=14)
    ax.set_xlabel("streamline arc length", fontsize=15)
    ax.set_ylabel("count", fontsize=15)
    ax.tick_params(labelsize=13)
    ax.set_title(f"{surface_name}: line length distribution "
                 f"(n={len(lengths)})", fontsize=17)
    fig.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)
