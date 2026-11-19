"""Face-colored planar SVG rendering."""

from __future__ import annotations

from .mesh import HalfEdgeMesh

PALETTE = [
    "#f6c85f", "#6f4e7c", "#9ed06f", "#e16a5f", "#5fa8d3",
    "#c2a4e8", "#8fd1c9", "#f29c6b", "#a3c96f", "#d77fa1",
]
OUTER_COLOR = "#f4f4f2"


def _bounds(mesh: HalfEdgeMesh) -> tuple[float, float, float, float]:
    xs = [v.x for v in mesh.vertices]
    ys = [v.y for v in mesh.vertices]
    return min(xs), min(ys), max(xs), max(ys)


def render_svg(mesh: HalfEdgeMesh, path: str, margin: float = 20.0,
               scale: float = 90.0) -> str:
    min_x, min_y, max_x, max_y = _bounds(mesh)
    width = (max_x - min_x) * scale + 2 * margin
    height = (max_y - min_y) * scale + 2 * margin

    def sx(x: float) -> float:
        return margin + (x - min_x) * scale

    def sy(y: float) -> float:
        return height - margin - (y - min_y) * scale

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.1f}" '
        f'height="{height:.1f}" viewBox="0 0 {width:.1f} {height:.1f}">',
        '<rect width="100%" height="100%" fill="white"/>',
    ]

    for face in mesh.faces:
        color = OUTER_COLOR if not face.bounded else PALETTE[face.fid % len(PALETTE)]
        for loop in face.loops:
            points = []
            for hid in loop:
                v = mesh.vertices[mesh.halfedges[hid].origin]
                points.append(f"{sx(v.x):.2f},{sy(v.y):.2f}")
            parts.append(
                f'  <polygon points="{" ".join(points)}" fill="{color}" '
                f'fill-opacity="0.85" stroke="none"/>'
            )

    for edge in mesh.edges:
        he = mesh.halfedges[edge.he_forward]
        a = mesh.vertices[he.origin]
        b = mesh.vertices[mesh.destination(edge.he_forward)]
        parts.append(
            f'  <line x1="{sx(a.x):.2f}" y1="{sy(a.y):.2f}" '
            f'x2="{sx(b.x):.2f}" y2="{sy(b.y):.2f}" '
            'stroke="#222222" stroke-width="1.6"/>'
        )

    for face in mesh.faces:
        if not face.bounded:
            continue
        first = face.loops[0]
        cx = sum(mesh.vertices[mesh.halfedges[h].origin].x for h in first) / len(first)
        cy = sum(mesh.vertices[mesh.halfedges[h].origin].y for h in first) / len(first)
        parts.append(
            f'  <text x="{sx(cx):.2f}" y="{sy(cy):.2f}" '
            'text-anchor="middle" font-family="sans-serif" font-size="13" '
            f'fill="#111111">F{face.fid} {face.area:.2f}</text>'
        )

    parts.append("</svg>")
    svg = "\n".join(parts)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(svg)
    return svg
