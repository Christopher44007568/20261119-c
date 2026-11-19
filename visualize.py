"""SVG / HTML visualization for the CDT process.

Renders the final mesh plus, for chosen vertex insertions, the local
retriangulation record: cavity (removed triangles), circumcircles of the
new triangles, and the edge-flip log.
"""

import html


def _transform(points, size, pad):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    span = max(x1 - x0, y1 - y0, 1e-12)
    scale = (size - 2 * pad) / span

    def tr(p):
        return ((p[0] - x0) * scale + pad,
                size - ((p[1] - y0) * scale + pad))

    return tr, scale


def render_svg(points, triangles, constraints=(), record=None, size=560,
               pad=24, title=""):
    """Render the mesh; if `record` (InsertionRecord) is given, highlight
    its cavity, draw circumcircles of new triangles and mark the point."""
    tr, scale = _transform(points, size, pad)
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" '
        f'height="{size}" viewBox="0 0 {size} {size}" '
        f'style="background:#fafafa;border:1px solid #ccc">'
    ]
    if record is not None:
        for tri in record.cavity:
            pts = " ".join(
                f"{tr(points[v])[0]:.1f},{tr(points[v])[1]:.1f}"
                for v in tri)
            out.append(f'<polygon points="{pts}" fill="#ffe9a8" '
                       f'stroke="none" opacity="0.85"/>')
    for a, b, c in triangles:
        pa, pb, pc = tr(points[a]), tr(points[b]), tr(points[c])
        out.append(
            f'<path d="M{pa[0]:.1f},{pa[1]:.1f} L{pb[0]:.1f},{pb[1]:.1f} '
            f'L{pc[0]:.1f},{pc[1]:.1f} Z" fill="none" '
            f'stroke="#9db4c8" stroke-width="1"/>')
    index = {p: i for i, p in enumerate(points)}
    for p, q in constraints:
        if p not in index or q not in index:
            continue
        pa, pq = tr(p), tr(q)
        out.append(
            f'<line x1="{pa[0]:.1f}" y1="{pa[1]:.1f}" x2="{pq[0]:.1f}" '
            f'y2="{pq[1]:.1f}" stroke="#d1495b" stroke-width="2.2"/>')
    if record is not None:
        for (cx, cy), r in record.circumcircles:
            cc = tr((cx, cy))
            out.append(
                f'<circle cx="{cc[0]:.1f}" cy="{cc[1]:.1f}" '
                f'r="{r * scale:.1f}" fill="none" stroke="#2a9d8f" '
                f'stroke-width="1" stroke-dasharray="4 3" '
                f'opacity="0.8"/>')
        pt = tr(record.point)
        out.append(f'<circle cx="{pt[0]:.1f}" cy="{pt[1]:.1f}" r="4.5" '
                   f'fill="#e76f51" stroke="#7a2e1d" stroke-width="1"/>')
    for p in points:
        t = tr(p)
        out.append(f'<circle cx="{t[0]:.1f}" cy="{t[1]:.1f}" r="1.8" '
                   f'fill="#264653"/>')
    if title:
        out.append(f'<text x="10" y="18" font-size="13" '
                   f'fill="#333">{html.escape(title)}</text>')
    out.append("</svg>")
    return "".join(out)


def _flip_log_html(record, points):
    if not record.flips:
        return "<p><em>no edge flips</em></p>"
    rows = []
    for (u, v), (c, d) in record.flips:
        rows.append(
            f"<tr><td>{u}-{v}</td><td>&rarr;</td><td>{c}-{d}</td>"
            f"<td>{points[u]}&ndash;{points[v]}</td>"
            f"<td>{points[c]}&ndash;{points[d]}</td></tr>")
    return ("<table border='1' cellpadding='4' cellspacing='0'>"
            "<tr><th>old edge</th><th></th><th>new edge</th>"
            "<th>old coords</th><th>new coords</th></tr>"
            + "".join(rows) + "</table>")


def write_report(cdt, records, path, size=560):
    """HTML report: final mesh plus one panel per insertion record."""
    points, triangles = cdt.export()
    constraints = cdt.constraint_segments()
    parts = [
        "<!doctype html><html><head><meta charset='utf-8'>",
        "<title>CDT report</title>",
        "<style>body{font-family:sans-serif;margin:24px}"
        ".panel{display:inline-block;vertical-align:top;margin:12px}"
        "table{font-size:12px;border-collapse:collapse}</style>",
        "</head><body>",
        "<h1>Constrained Delaunay Triangulation</h1>",
        "<div class='panel'><h2>final mesh</h2>",
        render_svg(points, triangles, constraints, size=size,
                   title=f"{len(triangles)} triangles, "
                         f"{len(points)} vertices"),
        "</div>",
    ]
    for i, rec in enumerate(records):
        parts.append("<div class='panel'>")
        parts.append(f"<h2>insert #{i} at {rec.point}</h2>")
        parts.append(render_svg(points, triangles, constraints,
                                record=rec, size=size,
                                title=f"cavity={len(rec.cavity)} "
                                      f"new={len(rec.new_triangles)} "
                                      f"flips={len(rec.flips)}"))
        parts.append("<h3>edge flips</h3>")
        parts.append(_flip_log_html(rec, points))
        parts.append("</div>")
    parts.append("</body></html>")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("".join(parts))
