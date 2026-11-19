export function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export function weightColor(weight, alpha = 1) {
  const t = clamp01(weight);
  if (weight < 0) {
    return `hsla(276, 88%, 69%, ${alpha})`;
  }
  const hue = 208 - 184 * t;
  const saturation = 88 + 7 * t;
  const lightness = 63 + 2 * t;
  return `hsla(${hue.toFixed(1)}, ${saturation.toFixed(1)}%, ${lightness.toFixed(1)}%, ${alpha})`;
}

export function formatWeight(value) {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && magnitude < 0.0001) return value.toExponential(2);
  return value.toFixed(6);
}

export function formatPoint(point) {
  if (!point) return '—';
  return `x ${point.x.toFixed(2)} · y ${point.y.toFixed(2)}`;
}

export function downloadJSON(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
