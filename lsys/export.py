"""Export of derivation trees, run manifests and source-coloured SVG views."""

from __future__ import annotations

import json

from .expander import ExpansionResult
from .mesh import Mesh
from .turtle import TurtleResult

# Stable colour per grammar rule so branch provenance is visually readable.
RULE_PALETTE = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
    "#42d4f4", "#f032e6", "#9a6324", "#808000", "#469990",
    "#000075", "#a9a9a9",
]


def rule_color(rule: str | None) -> str:
    if rule is None:
        return "#666666"
    index = (ord(rule) - ord("A")) % len(RULE_PALETTE)
    return RULE_PALETTE[index]


def write_derivation_json(result: ExpansionResult, path: str,
                          max_nodes: int = 200_000) -> None:
    """Serialize the complete derivation tree as JSON."""

    if len(result.tree) > max_nodes:
        raise ValueError(
            f"derivation tree has {len(result.tree)} nodes; raise max_nodes "
            "or export DOT with pruning instead"
        )
    payload = {
        "iterations": result.iterations,
        "root_ids": result.root_ids,
        "nodes": [
            {
                "id": node.node_id,
                "symbol": node.symbol,
                "iteration": node.iteration,
                "depth": node.depth,
                "rule": node.rule,
                "rhs_index": node.rhs_index,
                "parent_id": node.parent_id,
                "children": node.children,
            }
            for node in result.tree.values()
        ],
        "terminals": [
            {
                "symbol": token.symbol,
                "depth": token.depth,
                "node_id": token.node_id,
                "rule": token.rule,
                "rhs_index": token.rhs_index,
                "lineage": [list(step) for step in token.lineage],
            }
            for token in result.tokens
        ],
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1)


def write_derivation_dot(result: ExpansionResult, path: str,
                         max_nodes: int = 5_000) -> None:
    """Write a Graphviz DOT rendering of the (optionally pruned) tree."""

    nodes = result.tree
    pruned = len(nodes) > max_nodes
    selected = set(result.root_ids)
    if pruned:
        # Breadth-first budget keeps the early derivation structure intact.
        queue = list(result.root_ids)
        while queue and len(selected) < max_nodes:
            node_id = queue.pop(0)
            for child_id in nodes[node_id].children:
                if len(selected) >= max_nodes:
                    break
                selected.add(child_id)
                queue.append(child_id)

    lines = ["digraph derivation {", '  node [shape=circle, fontsize=10];']
    for node_id in sorted(selected):
        node = nodes[node_id]
        fill = rule_color(node.rule)
        lines.append(
            f'  n{node_id} [label="{node.symbol}\\n{node.iteration}", '
            f'style=filled, fillcolor="{fill}"];'
        )
    for node_id in sorted(selected):
        for child_id in nodes[node_id].children:
            if child_id in selected:
                lines.append(f"  n{node_id} -> n{child_id};")
    if pruned:
        lines.append(
            f'  note [shape=note, label="pruned: {len(nodes)} total '
            f'nodes, {len(selected)} shown"];'
        )
    lines.append("}")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def write_manifest(path: str, grammar_path: str, iterations: int,
                   estimate: dict, result: TurtleResult,
                   mesh: Mesh, validation: dict) -> None:
    """Write one JSON document describing the complete generation run."""

    payload = {
        "generator": "lsys",
        "procedural": True,
        "random_seed": None,
        "grammar_file": grammar_path,
        "iterations": iterations,
        "estimate": estimate,
        "stats": {
            "branch_count": len(result.branches),
            "forward_segments": result.forward_count,
            "stack_high_water": result.stack_high_water,
            "vertex_count": len(mesh.vertices),
            "face_count": len(mesh.faces),
        },
        "branches": [_branch_summary(branch) for branch in result.branches],
        "validation": validation,
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def _branch_summary(branch) -> dict:
    rule_counts: dict[str, int] = {}
    for source in branch.sources:
        if source.rule:
            rule_counts[source.rule] = rule_counts.get(source.rule, 0) + 1
    return {
        "branch_id": branch.branch_id,
        "parent_id": branch.parent_id,
        "depth": branch.depth,
        "segment_count": len(branch.sources),
        "start_rule": branch.start_rule,
        "rules_used": sorted(branch.rule_rules),
        "rule_segment_counts": rule_counts,
        "lineage_examples": [
            {
                "node_id": source.node_id,
                "rule": source.rule,
                "rhs_index": source.rhs_index,
                "lineage": [list(step) for step in source.lineage],
            }
            for source in branch.sources[:3]
        ],
    }


def write_svg(result: TurtleResult, path: str, title: str,
              plane: str = "xy", size: tuple[int, int] = (1100, 800)) -> None:
    """Draw an orthographic SVG projection coloured by rule provenance.

    Every tube segment is drawn in the colour of the rule that produced it,
    with a legend listing rule -> colour and segment counts.
    """

    project = _projector(plane)
    projected = [
        [project(point) for point in branch.points]
        for branch in result.branches
    ]
    flat = [point for polyline in projected for point in polyline]
    min_x = min(point[0] for point in flat)
    max_x = max(point[0] for point in flat)
    min_y = min(point[1] for point in flat)
    max_y = max(point[1] for point in flat)
    margin = 40
    scale = min(
        (size[0] - 2 * margin) / max(1e-9, max_x - min_x),
        (size[1] - 2 * margin - 60) / max(1e-9, max_y - min_y),
    )

    def to_canvas(point):
        return (
            margin + (point[0] - min_x) * scale,
            margin + (max_y - point[1]) * scale,
        )

    rule_totals: dict[str, int] = {}
    elements: list[str] = []
    for branch in result.branches:
        canvas = [to_canvas(project(point)) for point in branch.points]
        for index, source in enumerate(branch.sources):
            rule = source.rule or "axiom"
            rule_totals[rule] = rule_totals.get(rule, 0) + 1
            stroke = rule_color(source.rule)
            width = max(1.0, 6.0 * branch.radii[index + 1] /
                        max(1e-9, branch.radii[0]) *
                        (1.0 / (1.0 + 0.25 * branch.depth)))
            start = canvas[index]
            end = canvas[index + 1]
            elements.append(
                f'<line x1="{start[0]:.2f}" y1="{start[1]:.2f}" '
                f'x2="{end[0]:.2f}" y2="{end[1]:.2f}" '
                f'stroke="{stroke}" stroke-width="{width:.2f}" '
                'stroke-linecap="round" opacity="0.92"/>'
            )

    legend_y = size[1] - 30
    legend = ['<g font-family="monospace" font-size="13">']
    cursor_x = margin
    for rule in sorted(rule_totals):
        color = rule_color(None if rule == "axiom" else rule)
        label = f"{rule}: {rule_totals[rule]}"
        legend.append(
            f'<rect x="{cursor_x}" y="{legend_y - 12}" width="14" '
            f'height="14" fill="{color}"/>'
        )
        legend.append(
            f'<text x="{cursor_x + 19}" y="{legend_y}">{label}</text>'
        )
        cursor_x += 22 + 9 * len(label)
    legend.append("</g>")

    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size[0]}" '
        f'height="{size[1]}" viewBox="0 0 {size[0]} {size[1]}">',
        '<rect width="100%" height="100%" fill="white"/>',
        f'<text x="{margin}" y="24" font-family="monospace" '
        f'font-size="16">{title} ({plane} projection)</text>',
        *elements,
        *legend,
        "</svg>",
    ]
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(svg) + "\n")


def _projector(plane: str):
    if plane == "xy":
        return lambda point: (point[0], point[1])
    if plane == "yz":
        return lambda point: (point[1], point[2])
    if plane == "xz":
        return lambda point: (point[0], point[2])
    raise ValueError(f"unknown projection plane {plane}")
