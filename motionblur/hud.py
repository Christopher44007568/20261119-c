"""HUD overlay drawn AFTER the motion-blur pass.

The HUD never touches the depth or velocity buffers, so it stays
perfectly sharp no matter how strong the camera/object motion is.
"""


def _fill_rect(color, width, height, x0, y0, x1, y1, rgb):
    for y in range(max(0, y0), min(height, y1)):
        row = y * width
        for x in range(max(0, x0), min(width, x1)):
            color[row + x] = rgb


def _draw_crosshair(color, width, height, rgb=(1.0, 1.0, 1.0)):
    cx, cy = width // 2, height // 2
    arm, gap, thick = 8, 3, 1
    _fill_rect(color, width, height, cx - arm, cy - thick, cx - gap, cy + thick + 1, rgb)
    _fill_rect(color, width, height, cx + gap + 1, cy - thick, cx + arm + 1, cy + thick + 1, rgb)
    _fill_rect(color, width, height, cx - thick, cy - arm, cx + thick + 1, cy - gap, rgb)
    _fill_rect(color, width, height, cx - thick, cy + gap + 1, cx + thick + 1, cy + arm + 1, rgb)


def _draw_bar(color, width, height, x0, y0, bar_w, bar_h, fraction, fg, bg):
    _fill_rect(color, width, height, x0, y0, x0 + bar_w, y0 + bar_h, bg)
    _fill_rect(color, width, height, x0, y0, x0 + int(bar_w * fraction), y0 + bar_h, fg)


_FONT = {
    "F": ["111", "100", "110", "100", "100"],
    "P": ["110", "101", "110", "100", "100"],
    "S": ["011", "100", "010", "001", "110"],
    "H": ["101", "101", "111", "101", "101"],
    "0": ["111", "101", "101", "101", "111"],
    "6": ["011", "100", "111", "101", "111"],
    "3": ["110", "001", "011", "001", "110"],
    " ": ["000", "000", "000", "000", "000"],
}


def _draw_text(color, width, height, x0, y0, text, rgb, scale=1):
    x = x0
    for ch in text:
        glyph = _FONT.get(ch)
        if glyph is None:
            x += 4 * scale
            continue
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit == "1":
                    _fill_rect(
                        color, width, height,
                        x + gx * scale, y0 + gy * scale,
                        x + (gx + 1) * scale, y0 + (gy + 1) * scale,
                        rgb,
                    )
        x += 4 * scale


def draw_hud(color, width, height, fps=60, health=0.72):
    """Composite the HUD directly onto the (already blurred) frame."""
    _draw_crosshair(color, width, height)
    _draw_bar(color, width, height, 8, height - 16, 80, 8, health,
              (0.2, 0.9, 0.3), (0.15, 0.15, 0.15))
    _draw_bar(color, width, height, 8, height - 26, 80, 4, 1.0,
              (0.9, 0.9, 0.9), (0.15, 0.15, 0.15))
    fps_text = "FPS60" if fps >= 60 else ("FPS30" if fps >= 30 else "FPS  ")
    _draw_text(color, width, height, width - 60, 8, fps_text, (1.0, 1.0, 1.0), scale=2)
    _draw_text(color, width, height, 8, 8, "HP", (0.2, 0.9, 0.3), scale=2)
