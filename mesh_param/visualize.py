"""Matplotlib visualizations: UV layout, distortion heatmaps, textured 3D."""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import PolyCollection
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

from .distortion import DistortionReport
from .mesh import Mesh
from .texture import checker_colors


def _uv_polygons(mesh: Mesh) -> list[np.ndarray]:
    return [mesh.uvs[f] for f in mesh.faces]


def plot_uv(mesh: Mesh, report: DistortionReport, path: str,
            title: str = "") -> None:
    """UV layout; flipped triangles filled red, boundary circle dashed."""
    fig, ax = plt.subplots(figsize=(7, 7))
    polys = _uv_polygons(mesh)
    coll = PolyCollection(polys, facecolor="lightsteelblue",
                          edgecolor="0.35", linewidth=0.3)
    ax.add_collection(coll)
    if report.flipped.any():
        flip_polys = [p for p, f in zip(polys, report.flipped) if f]
        ax.add_collection(PolyCollection(flip_polys, facecolor="red",
                                         edgecolor="darkred", linewidth=0.5))
    theta = np.linspace(0, 2 * np.pi, 200)
    ax.plot(np.cos(theta), np.sin(theta), "k--", lw=0.8, alpha=0.5)
    ax.set_aspect("equal")
    ax.autoscale_view()
    ax.set_title(title or f"UV layout ({mesh.name})")
    ax.set_xlabel("u")
    ax.set_ylabel("v")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def plot_distortion(mesh: Mesh, values: np.ndarray, path: str,
                    title: str, cmap: str = "viridis") -> None:
    """Per-triangle scalar field drawn on the UV domain."""
    fig, ax = plt.subplots(figsize=(7.5, 7))
    coll = PolyCollection(_uv_polygons(mesh), array=values, cmap=cmap,
                          edgecolor="0.4", linewidth=0.15)
    ax.add_collection(coll)
    ax.set_aspect("equal")
    ax.autoscale_view()
    fig.colorbar(coll, ax=ax, shrink=0.8)
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def plot_textured(mesh: Mesh, path: str, cells: int = 16,
                  title: str = "") -> None:
    """3D mesh colored by sampling the checkerboard at each face centroid."""
    if mesh.uvs is None:
        raise ValueError("mesh has no UVs")
    uv = mesh.uvs.copy()
    uv -= uv.min(axis=0)
    span = uv.max(axis=0)
    span[span == 0] = 1.0
    uv /= span

    centroids_uv = uv[mesh.faces].mean(axis=1)
    colors = checker_colors(centroids_uv, cells=cells)

    fig = plt.figure(figsize=(8, 7))
    ax = fig.add_subplot(111, projection="3d")
    tris = mesh.vertices[mesh.faces]
    coll = Poly3DCollection(tris, facecolor=colors, edgecolor="0.25",
                            linewidth=0.15)
    ax.add_collection3d(coll)
    mins = mesh.vertices.min(axis=0)
    maxs = mesh.vertices.max(axis=0)
    flat = maxs - mins < 1e-9
    maxs[flat] = mins[flat] + 1.0
    ax.set_xlim(mins[0], maxs[0])
    ax.set_ylim(mins[1], maxs[1])
    ax.set_zlim(mins[2], maxs[2])
    ax.set_box_aspect((maxs - mins) + 1e-9)
    ax.set_title(title or f"Checkerboard mapped back ({mesh.name})")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)
