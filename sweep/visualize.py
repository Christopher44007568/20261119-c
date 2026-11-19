"""Dependency-free 3D-to-SVG wireframe renderer.

An orthographic camera projects points to screen space.  The renderer draws
mesh edges in light gray and frame axes in RGB-ish colors:
tangent = red, normal = green, binormal = blue.
"""

from __future__ import annotations
import math

from .frame import Frame
from .mesh import Mesh
from .vector import Vec, add, cross, normalize, scale, sub


class Camera:
    def __init__(self, target: Vec, distance: float,
                 azimuth: float = math.radians(35.0),
                 elevation: float = math.radians(25.0)):
        self.target = target
        self.distance = distance
        self.azimuth = azimuth
        self.elevation = elevation
        eye = (
            target[0] + distance * math.cos(elevation) * math.cos(azimuth),
            target[1] + distance * math.cos(elevation) * math.sin(azimuth),
            target[2] + distance * math.sin(elevation),
        )
        forward = normalize(sub(target, eye))
        world_up = (0.0, 0.0, 1.0)
        right = normalize(cross(forward, world_up))
        up = cross(right, forward)
        self.eye = eye
        self.right = right
        self.up = up

    def project(self, point: Vec) -> tuple[float, float]:
        rel = sub(point, self.eye)
        x = rel[0] * self.right[0] + rel[1] * self.right[1] + rel[2] * self.right[2]
        y = rel[0] * self.up[0] + rel[1] * self.up[1] + rel[2] * self.up[2]
        return x, y


def _fit(points2d, width, height, margin=40.0):
    xs = [p[0] for p in points2d]
    ys = [p[1] for p in points2d]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    span_x = max(maxx - minx, 1e-9)
    span_y = max(maxy - miny, 1e-9)
    scale_xy = min((width - 2 * margin) / span_x,
                   (height - 2 * margin) / span_y)

    def map_pt(p):
        x = margin + (p[0] - minx) * scale_xy
        y = margin + (maxy - p[1]) * scale_xy  # flip screen Y
        return x, y

    return map_pt


def render_svg(
    mesh: Mesh | None,
    frames: list[Frame],
    path: str,
    width: int = 1100,
    height: int = 800,
    axis_length: float = 0.55,
    title: str = "parallel transport frames",
) -> str:
    all_points = [f.position for f in frames]
    if mesh is not None:
        all_points = all_points + mesh.vertices
    center = (
        sum(p[0] for p in all_points) / len(all_points),
        sum(p[1] for p in all_points) / len(all_points),
        sum(p[2] for p in all_points) / len(all_points),
    )
    extent = max(
        math.sqrt(sum((p[k] - center[k]) ** 2 for k in range(3)))
        for p in all_points
    )
    camera = Camera(center, distance=max(extent * 4.0, 1.0))
    projected_world = [camera.project(p) for p in all_points]
    map_pt = _fit(projected_world, width, height)

    elements: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
        f'height="{height}" viewBox="0 0 {width} {height}" font-family="sans-serif">',
        '<rect width="100%" height="100%" fill="white"/>',
        f'<text x="20" y="30" font-size="20" fill="#222">{title}</text>',
        '<text x="20" y="52" font-size="13" fill="#555">'
        'red=tangent green=normal blue=binormal</text>',
    ]

    if mesh is not None:
        seen_edges: set[tuple[int, int]] = set()
        for face in mesh.faces:
            for i in range(len(face)):
                a, b = face[i], face[(i + 1) % len(face)]
                key = (min(a, b), max(a, b))
                if key in seen_edges:
                    continue
                seen_edges.add(key)
                p0 = map_pt(camera.project(mesh.vertices[a]))
                p1 = map_pt(camera.project(mesh.vertices[b]))
                elements.append(
                    f'<line x1="{p0[0]:.2f}" y1="{p0[1]:.2f}" '
                    f'x2="{p1[0]:.2f}" y2="{p1[1]:.2f}" '
                    'stroke="#cccccc" stroke-width="0.7"/>'
                )

    axis_specs = [
        (lambda f: f.tangent, "#d13b3b"),
        (lambda f: f.normal, "#2f9e44"),
        (lambda f: f.binormal, "#1c6fe0"),
    ]
    for frame in frames:
        origin = map_pt(camera.project(frame.position))
        for accessor, color in axis_specs:
            tip_world = add(frame.position, scale(accessor(frame), axis_length))
            tip = map_pt(camera.project(tip_world))
            elements.append(
                f'<line x1="{origin[0]:.2f}" y1="{origin[1]:.2f}" '
                f'x2="{tip[0]:.2f}" y2="{tip[1]:.2f}" '
                f'stroke="{color}" stroke-width="1.4"/>'
            )
        elements.append(
            f'<circle cx="{origin[0]:.2f}" cy="{origin[1]:.2f}" '
            'r="1.6" fill="#222"/>'
        )

    elements.append("</svg>")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(elements))
    return path
