"""Deterministic L-system expansion with full provenance tracking.

Two entry points:

* :func:`estimate_expansion` computes the exact final string length and symbol
  histogram for any iteration count without materialising the string, using
  production-count matrices assembled from the grammar.  This lets the caller
  cap recursion *before* allocating anything.
* :func:`expand` performs the bounded expansion and returns both the flat
  terminal symbol stream (every token remembers its derivation lineage) and a
  full derivation tree (one node per symbol instance across all iterations).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .errors import ExpansionLimitError
from .parser import Grammar, Token


@dataclass(frozen=True)
class ExpandedToken:
    """A terminal symbol plus its derivation provenance."""

    symbol: str
    depth: int                      # bracket nesting depth at generation
    node_id: int                    # id of the leaf derivation-tree node
    rule: str | None                # rule whose application created it
    rhs_index: int                  # position on that rule's right-hand side
    lineage: tuple[tuple[str, int], ...]  # (rule, rhs_index) ancestry chain


@dataclass
class DerivationNode:
    """One symbol instance in the derivation tree."""

    node_id: int
    symbol: str
    iteration: int
    depth: int
    rule: str | None
    rhs_index: int
    parent_id: int | None
    children: list[int] = field(default_factory=list)


@dataclass
class ExpansionResult:
    tokens: list[ExpandedToken]
    tree: dict[int, DerivationNode]
    root_ids: list[int]
    iterations: int
    counts_per_iteration: list[dict[str, int]]


def estimate_expansion(grammar: Grammar, iterations: int) -> dict:
    """Return exact projected sizes for ``iterations`` derivation steps.

    The string itself is never built: only per-symbol count tables are
    multiplied, so a grammar that would explode to billions of symbols can be
    rejected in microseconds.
    """

    if iterations < 0:
        raise ValueError("iterations must be non-negative")

    counts: dict[str, int] = {}
    for token in grammar.axiom:
        counts[token.symbol] = counts.get(token.symbol, 0) + 1

    per_iteration: list[dict[str, int]] = [dict(counts)]
    max_depth = _stream_depth(grammar.axiom)
    for step in range(iterations):
        new_counts: dict[str, int] = {}
        for symbol, count in counts.items():
            rhs = grammar.rules.get(symbol)
            if rhs is None:
                new_counts[symbol] = new_counts.get(symbol, 0) + count
                continue
            for token in rhs:
                child = token.symbol
                new_counts[child] = new_counts.get(child, 0) + count
            max_depth = max(
                max_depth,
                _stream_depth(rhs) * max(1, step + 1) + _stream_depth(grammar.axiom),
            )
        counts = new_counts
        per_iteration.append(dict(counts))

    total = sum(counts.values())
    forward = sum(counts.get(symbol, 0) for symbol in ("F", "G"))
    pushes = counts.get("[", 0)
    return {
        "iterations": iterations,
        "total_symbols": total,
        "forward_symbols": forward,
        "branch_pushes": pushes,
        "max_bracket_depth": _max_bracket_depth(grammar, iterations),
        "symbol_counts": dict(sorted(counts.items())),
        "counts_per_iteration": per_iteration,
    }


def _stream_depth(tokens: list[Token]) -> int:
    depth = 0
    peak = 0
    for token in tokens:
        if token.symbol == "[":
            depth += 1
            peak = max(peak, depth)
        elif token.symbol == "]":
            depth -= 1
    return peak


def _max_bracket_depth(grammar: Grammar, iterations: int) -> int:
    """Worst nesting depth reachable by chaining the deepest rules."""

    depth_of = {symbol: _stream_depth(rhs)
                for symbol, rhs in grammar.rules.items()}
    # Fixed-point style upper bound: each iteration can add the deepest
    # bracket block reachable from any currently producible symbol.
    reachable = {token.symbol for token in grammar.axiom}
    for _ in range(iterations):
        grown = set(reachable)
        for symbol in reachable:
            rhs = grammar.rules.get(symbol)
            if rhs:
                grown.update(token.symbol for token in rhs)
        reachable = grown
    deepest_rule = max((depth_of.get(symbol, 0) for symbol in reachable),
                       default=0)
    return _stream_depth(grammar.axiom) + iterations * deepest_rule


def expand(grammar: Grammar, iterations: int,
           max_iterations: int = 12,
           max_symbols: int = 5_000_000,
           max_depth: int = 256) -> ExpansionResult:
    """Expand the grammar with hard safety limits.

    Limits are enforced *before* the expensive expansion runs, using
    :func:`estimate_expansion`, and re-checked while building the tree so a
    malformed grammar can never exhaust memory.
    """

    if iterations < 0:
        raise ValueError("iterations must be non-negative")
    if iterations > max_iterations:
        raise ExpansionLimitError(
            f"requested {iterations} iterations exceeds limit "
            f"{max_iterations}; raise max_iterations explicitly to override"
        )
    estimate = estimate_expansion(grammar, iterations)
    if estimate["total_symbols"] > max_symbols:
        raise ExpansionLimitError(
            f"expansion would contain {estimate['total_symbols']:,} symbols "
            f"(limit {max_symbols:,}). Run estimate first and reduce "
            "iterations, or raise max_symbols explicitly."
        )
    if estimate["max_bracket_depth"] > max_depth:
        raise ExpansionLimitError(
            f"bracket nesting could reach depth "
            f"{estimate['max_bracket_depth']} (limit {max_depth})"
        )

    tree: dict[int, DerivationNode] = {}
    root_ids: list[int] = []
    next_id = 0

    # Level 0: the axiom instances.  Each worklist item carries the bracket
    # depth at which the symbol appears, since depth is traversal state and
    # cannot be reconstructed from parent/child node relations.
    current_level: list[tuple[int, int]] = []
    for index, token in enumerate(grammar.axiom):
        node = DerivationNode(
            node_id=next_id, symbol=token.symbol, iteration=0, depth=0,
            rule=None, rhs_index=index, parent_id=None,
        )
        tree[next_id] = node
        root_ids.append(next_id)
        current_level.append((next_id, 0))
        next_id += 1

    for step in range(1, iterations + 1):
        next_level: list[tuple[int, int]] = []
        for parent_id, _parent_depth in current_level:
            parent = tree[parent_id]
            rhs = grammar.rules.get(parent.symbol)
            if rhs is None:
                continue  # terminal symbol: stays in the final stream
            child_depth = parent.depth
            for rhs_index, token in enumerate(rhs):
                if token.symbol == "[":
                    child_depth += 1
                elif token.symbol == "]":
                    child_depth -= 1
                if child_depth < 0:
                    raise ExpansionLimitError(
                        "bracket stack underflow during expansion"
                    )
                if child_depth > max_depth:
                    raise ExpansionLimitError(
                        f"bracket nesting exceeded {max_depth}"
                    )
                node = DerivationNode(
                    node_id=next_id,
                    symbol=token.symbol,
                    iteration=step,
                    depth=child_depth,
                    rule=parent.symbol,
                    rhs_index=rhs_index,
                    parent_id=parent_id,
                )
                tree[next_id] = node
                parent.children.append(next_id)
                next_level.append((next_id, child_depth))
                next_id += 1
        current_level = next_level

    if len(tree) > max_symbols:
        raise ExpansionLimitError(
            f"derivation tree holds {len(tree):,} nodes (limit {max_symbols:,})"
        )

    tokens = _flatten_leaves(tree, root_ids)
    return ExpansionResult(
        tokens=tokens,
        tree=tree,
        root_ids=root_ids,
        iterations=iterations,
        counts_per_iteration=estimate["counts_per_iteration"],
    )


def _flatten_leaves(tree: dict[int, DerivationNode],
                    root_ids: list[int]) -> list[ExpandedToken]:
    """Depth-first walk preserving exact terminal-symbol order."""

    flattened: list[ExpandedToken] = []
    # Stack frames: (node_id, lineage so far).
    stack: list[tuple[int, tuple[tuple[str, int], ...]]] = [
        (node_id, ()) for node_id in reversed(root_ids)
    ]
    bracket_depth = 0
    while stack:
        node_id, lineage = stack.pop()
        node = tree[node_id]
        if node.symbol == "[":
            bracket_depth += 1
        elif node.symbol == "]":
            bracket_depth -= 1
        if not node.children:
            own_lineage = lineage
            if node.rule is not None:
                own_lineage = lineage + ((node.rule, node.rhs_index),)
            flattened.append(
                ExpandedToken(
                    symbol=node.symbol,
                    depth=max(0, bracket_depth),
                    node_id=node.node_id,
                    rule=node.rule,
                    rhs_index=node.rhs_index,
                    lineage=own_lineage,
                )
            )
            continue
        child_lineage = lineage
        if node.rule is not None:
            child_lineage = lineage + ((node.rule, node.rhs_index),)
        for child_id in reversed(node.children):
            stack.append((child_id, child_lineage))
    return flattened
