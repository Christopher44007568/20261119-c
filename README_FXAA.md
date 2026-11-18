# Luminance-Difference Fast Edge Anti-Aliasing (FXAA-style)

## Algorithm (`fxaa.py`)

1. **Luma** — Rec.601 weights (`to_luma`).
2. **Edge mask** — local contrast over the 4-neighbourhood *plus the
   center pixel*; a pixel is an edge when
   `range >= max(abs_threshold, rel_threshold * local_max)`.
3. **Low-contrast attenuation** — blend strength ramps in softly just
   above the threshold instead of a hard cut, so faint edges (text,
   shading) are barely touched.
4. **Orientation** — 3x3 gradient vote decides whether the edge runs
   horizontally or vertically; the blend offset is applied
   perpendicular to the edge, toward the edge side.
5. **Along-edge search** — from the half-pixel boundary sample, march
   along the edge tangent (steps 1.0/1.5/2.0/2.0/4.0) until the luma
   leaves the edge range; blend fades out near edge ends so corners
   stay sharp.
6. **Thin-feature guard** — a pixel that is a strict extremum against
   both neighbours along the blend axis (1px lines, text strokes) gets
   its blend cut to 15%; border pixels are checked against their two
   inward neighbours so 1px lines on the image boundary survive too.
7. Final colour = bilinear sample of the input at `center + offset`.

Outputs per run: AA result, edge mask (blend strength), per-pixel
blend vectors, orientation map.

## Evaluation (`run_all.py`)

Scenarios (`test_images.py`): hard edges, gradient, noise, 1px
diagonal line, checkerboard, low-contrast text, flat blocks, and an
odd-sized (191x137) boundary case.

Metrics (`metrics.py`):

- **Edge preservation rate** — fraction of input edge pixels whose
  local contrast keeps >= 50% after AA.
- **Per-pixel error** — luma error vs an 8x supersampled reference
  (geometric scenes) or vs the input (noise/text); exported as a
  heatmap in each `*_compare.png`.
- **Export/reload** — every result is written to PNG, reloaded, and
  required to be bit-identical.
- **Flat invariance** — non-edge pixels of `flat_blocks` must not
  change at all (max change 0.0).
- **Scaling continuity** (`scaling_test.py`) — a shallow-slope line is
  nearest-downsampled at 60 continuously varying scales; after AA the
  frame-to-frame MAE, edge jaggedness, and mean blend orientation must
  not jump (no directional popping).

Run: `python3 run_all.py` — writes figures, result PNGs and
`report.json` to `artifacts/out/`, and fails loudly if any invariant
breaks.

## Latest results

| scenario | preservation | MAE | notes |
|---|---|---|---|
| hard_edges | 1.000 | 0.0019 | error only on edges |
| gradient | 1.000 | 0.0007 | no edge pixels found |
| noise | 0.997 | 0.0358 | mild denoising-like smoothing |
| diagonal_line | 1.000 | 0.0076 | 1px line kept, guard active |
| checkerboard | 0.862 | 0.1597 | worst case: corners soften |
| low_contrast_text | 0.996 | 0.0012 | attenuation keeps strokes |
| flat_blocks | 1.000 | 0.0018 | interior bit-exact (0.0) |
| size_boundary | 1.000 | 0.0061 | border lines preserved |

Scaling sweep: max frame MAE 0.007 (< 0.05), jaggedness < 1 px,
blend-orientation jump 0.0 deg (< 15 deg).
