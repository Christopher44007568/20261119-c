"""L-system grammar parser.

Grammar text (UTF-8, line oriented)::

    # comment
    angle 25.7          # default turning angle in degrees
    step 1.0            # length of one F move
    width 0.14          # initial branch radius
    branch_scale 0.72   # radius factor applied when entering a [ branch ]
    width_scale 0.85    # radius factor applied by '!'
    length_scale 0.9    # length factor applied by '?'
    segments 8          # radial cross-section resolution
    axiom A
    A -> F[+A][-A]FA

Turtle symbols:

    F G   forward, drawing a tube segment
    f     forward without drawing (gap; current tube is capped)
    + -   turn around the local Z axis (yaw left / right)
    & ^   pitch down / up around the local X axis
    \\ /   roll counter-clockwise / clockwise around the local Y (heading) axis
    |     U-turn, rotate 180 degrees around local Z
    !     shrink the current radius by width_scale
    ?     shrink the current segment length by length_scale
    [ ]   push / pop the complete turtle state (branch stack)

Every syntax error is reported with the exact 1-based line and column of the
offending symbol, plus a caret rendered against the source line.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from .errors import LSystemSyntaxError

_TOKEN_RE = re.compile(r"->|=>|-?\d+(?:\.\d+)?|[A-Za-z_]\w*|\S")

# Symbols that carry geometric meaning at turtle evaluation time.
COMMAND_SYMBOLS = set("FGf+-&^\\/[]!?|")

_DIRECTIVES = {
    "angle": "angle",
    "step": "step",
    "length": "step",
    "width": "width",
    "radius": "width",
    "branch_scale": "branch_scale",
    "branch_width": "branch_scale",
    "width_scale": "width_scale",
    "length_scale": "length_scale",
    "segments": "segments",
    "sides": "segments",
}


@dataclass(frozen=True)
class Token:
    """A single grammar symbol with its source location."""

    symbol: str
    line: int
    column: int
    offset: int


@dataclass
class Grammar:
    """Parsed deterministic (D0L) grammar."""

    axiom: list[Token]
    rules: dict[str, list[Token]]
    params: dict[str, float]
    warnings: list[str] = field(default_factory=list)
    source_lines: list[str] = field(default_factory=list)

    def rule_for(self, symbol: str) -> list[Token] | None:
        return self.rules.get(symbol)

    @property
    def angle_radians(self) -> float:
        return math.radians(self.params["angle"])


def _tokenize_line(line: str, line_no: int, base_offset: int) -> list[Token]:
    tokens: list[Token] = []
    for match in _TOKEN_RE.finditer(line):
        tokens.append(
            Token(
                symbol=match.group(0),
                line=line_no,
                column=match.start() + 1,
                offset=base_offset + match.start(),
            )
        )
    return tokens


def _fail(token: Token, message: str, lines: list[str]) -> LSystemSyntaxError:
    return LSystemSyntaxError(
        message, token.line, token.column,
        lines[token.line - 1], token.offset,
    )


def _check_brackets(tokens: list[Token], lines: list[str],
                    context: str) -> None:
    depth = 0
    for token in tokens:
        if token.symbol == "[":
            depth += 1
        elif token.symbol == "]":
            depth -= 1
            if depth < 0:
                raise _fail(
                    token, f"unmatched ']' in {context}: no matching '['",
                    lines,
                )
    if depth:
        offender = next(t for t in reversed(tokens) if t.symbol == "[")
        raise _fail(
            offender,
            f"unmatched '[' in {context}: missing {depth} matching ']'",
            lines,
        )


def parse_grammar(source: str) -> Grammar:
    """Parse grammar text, raising :class:`LSystemSyntaxError` on failure."""

    lines = source.splitlines()
    params: dict[str, float] = {
        "angle": 25.0,
        "step": 1.0,
        "width": 0.14,
        "branch_scale": 0.72,
        "width_scale": 0.85,
        "length_scale": 0.9,
        "segments": 8.0,
    }
    axiom: list[Token] | None = None
    rules: dict[str, list[Token]] = {}
    warnings: list[str] = []
    base_offset = 0

    for line_no, raw_line in enumerate(lines, start=1):
        line = raw_line.split("#", 1)[0]
        tokens = _tokenize_line(line, line_no, base_offset)
        base_offset += len(raw_line) + 1
        if not tokens:
            continue

        head = tokens[0]
        key = head.symbol.lower()

        if key in _DIRECTIVES:
            if len(tokens) < 2:
                raise _fail(head, f"directive '{head.symbol}' expects a value",
                            lines)
            value_token = tokens[1]
            try:
                value = float(value_token.symbol)
            except ValueError:
                raise _fail(
                    value_token,
                    f"expected numeric value for '{head.symbol}', "
                    f"found '{value_token.symbol}'",
                    lines,
                ) from None
            if len(tokens) > 2:
                raise _fail(tokens[2], "unexpected extra token after value",
                            lines)
            params[_DIRECTIVES[key]] = value
            continue

        if key == "axiom":
            if len(tokens) < 2:
                col = len(line.rstrip()) + 1
                raise LSystemSyntaxError(
                    "axiom must contain at least one symbol",
                    line_no, col, raw_line, base_offset - len(raw_line) + col - 1,
                )
            axiom = _validate_symbol_stream(tokens[1:], lines, "axiom")
            _check_brackets(axiom, lines, "axiom")
            continue

        # Everything else must be a production rule: LHS -> RHS
        arrow_index = next(
            (i for i, token in enumerate(tokens)
             if token.symbol in ("->", "=>")),
            None,
        )
        if arrow_index is None:
            raise _fail(
                head,
                f"unexpected symbol '{head.symbol}': expected a directive, "
                "'axiom' or a rule with '->'",
                lines,
            )
        lhs_tokens = tokens[:arrow_index]
        if len(lhs_tokens) != 1 or len(head.symbol) != 1 or not head.symbol.isupper():
            raise _fail(
                head,
                "rule left-hand side must be a single uppercase letter, "
                f"found '{head.symbol}'",
                lines,
            )
        if head.symbol in rules:
            raise _fail(head,
                        f"duplicate rule for '{head.symbol}'", lines)
        rhs_tokens = tokens[arrow_index + 1:]
        if not rhs_tokens:
            arrow = tokens[arrow_index]
            raise _fail(
                arrow,
                "unexpected end of rule: '->' must be followed by symbols",
                lines,
            )
        rhs = _validate_symbol_stream(rhs_tokens, lines,
                                      f"rule '{head.symbol}'")
        _check_brackets(rhs, lines, f"rule '{head.symbol}'")
        rules[head.symbol] = rhs

    if axiom is None:
        raise LSystemSyntaxError(
            "grammar is missing an 'axiom' declaration",
            1, 1, lines[0] if lines else "", 0,
        )
    if int(params["segments"]) < 3:
        raise LSystemSyntaxError(
            "segments must be at least 3", 1, 1,
            lines[0] if lines else "", 0,
        )

    _warn_unknown_symbols(axiom, rules, warnings)
    return Grammar(
        axiom=axiom,
        rules=rules,
        params=params,
        warnings=warnings,
        source_lines=lines,
    )


def _validate_symbol_stream(tokens: list[Token], lines: list[str],
                            context: str) -> list[Token]:
    for token in tokens:
        symbol = token.symbol
        if len(symbol) != 1:
            raise _fail(
                token,
                f"unexpected token '{symbol}' in {context}; "
                "rule symbols are single characters",
                lines,
            )
        if not (symbol.isalpha() or symbol in COMMAND_SYMBOLS):
            raise _fail(
                token,
                f"unknown symbol '{symbol}' in {context}",
                lines,
            )
    return list(tokens)


def _warn_unknown_symbols(axiom: list[Token],
                          rules: dict[str, list[Token]],
                          warnings: list[str]) -> None:
    known = set(rules) | COMMAND_SYMBOLS
    streams = [("axiom", axiom)]
    streams.extend((f"rule '{lhs}'", rhs) for lhs, rhs in rules.items())
    for context, stream in streams:
        for token in stream:
            symbol = token.symbol
            if symbol.isalpha() and symbol not in known:
                warnings.append(
                    f"[line {token.line}:{token.column}] symbol '{symbol}' "
                    f"in {context} has no rule and no command meaning; "
                    "it expands to nothing"
                )
