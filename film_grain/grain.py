"""Stable film grain added after tone mapping.

Design properties
-----------------
* Grain is a *luma* perturbation: the same zero-mean field modulates every
  channel, so chromaticity is not shifted.
* Spatial scale is set by a Gaussian low-pass kernel (standard deviation in
  pixels) applied to white Gaussian noise; the field is re-normalized to
  exactly zero mean and unit standard deviation, so the requested intensity
  maps directly onto a standard deviation in display units.
* Per-pixel amplitude scales with luminance:
  ``amp(L) = intensity * (shadow_gain + (highlight_gain - shadow_gain)
  * L^gamma) * L^gamma``.  Because of the explicit ``L^gamma`` factor the
  amplitude is exactly zero at L = 0, hence pure black pixels are bit-exact
  and never lifted toward gray.
* Two temporal modes: ``fixed`` (one static field reused for every frame) and
  ``evolving`` (an AR(1) process over spatially correlated fields, controlled
  by the temporal correlation coefficient).
* When intensity is zero the input array is returned untouched, bit for bit.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import gaussian_filter


@dataclass(frozen=True)
class GrainConfig:
    """Tunable film-grain parameters."""

    intensity: float = 0.05
    scale: float = 1.0
    shadow_gain: float = 1.0
    highlight_gain: float = 0.6
    gamma: float = 1.0
    temporal_corr: float = 0.8
    mode: str = "fixed"
    seed: int | None = 0

    def __post_init__(self) -> None:
        if self.intensity < 0:
            raise ValueError("intensity must be non-negative")
        if self.scale <= 0:
            raise ValueError("scale must be positive")
        if self.shadow_gain < 0 or self.highlight_gain < 0:
            raise ValueError("gains must be non-negative")
        if self.gamma <= 0:
            raise ValueError("gamma must be positive")
        if not 0.0 <= self.temporal_corr < 1.0:
            raise ValueError("temporal_corr must lie in [0, 1)")
        if self.mode not in ("fixed", "evolving"):
            raise ValueError("mode must be 'fixed' or 'evolving'")


class SpatialNoiseField:
    """Generates spatially correlated, exactly standardized white-ish fields."""

    def __init__(self, scale: float = 1.0,
                 seed: int | None = 0) -> None:
        if scale <= 0:
            raise ValueError("scale must be positive")
        self.scale = float(scale)
        self._rng = np.random.default_rng(seed)

    def sample(self, shape: tuple[int, ...]) -> np.ndarray:
        """Return a zero-mean / unit-std Gaussian field of given shape."""
        white = self._rng.standard_normal(shape)
        if self.scale > 1.0e-8:
            field = gaussian_filter(white, sigma=self.scale, mode="reflect")
        else:
            field = white
        field -= field.mean()
        std = field.std()
        if std > 0:
            field /= std
        return field


def _luminance(image: np.ndarray) -> np.ndarray:
    """Rec.709 luma for RGB images; identity for grayscale images."""
    if image.ndim == 2:
        return image
    if image.ndim == 3 and image.shape[-1] in (3, 4):
        rgb = image[..., :3]
        weights = np.array([0.2126, 0.7152, 0.0722])
        return np.tensordot(rgb, weights, axes=(-1, 0))
    raise ValueError("expected a grayscale (H, W) or color (H, W, C) image")


class FilmGrain:
    """Stateful film-grain processor with fixed and evolving modes."""

    def __init__(self, config: GrainConfig | None = None, **kwargs) -> None:
        self.config = config if config is not None else GrainConfig(**kwargs)
        self._field_gen = SpatialNoiseField(self.config.scale,
                                            self.config.seed)
        self._fixed: dict[tuple[int, ...], np.ndarray] = {}
        self._previous: dict[tuple[int, ...], np.ndarray] = {}

    def reset(self, seed: int | None = None) -> None:
        """Clear temporal state and optionally reseed the RNG."""
        if seed is not None:
            self._field_gen = SpatialNoiseField(self.config.scale, seed)
        self._fixed.clear()
        self._previous.clear()

    def _next_field(self, shape: tuple[int, ...]) -> np.ndarray:
        mode = self.config.mode
        if mode == "fixed":
            field = self._fixed.get(shape)
            if field is None:
                field = self._field_gen.sample(shape)
                self._fixed[shape] = field
            return field

        fresh = self._field_gen.sample(shape)
        rho = self.config.temporal_corr
        previous = self._previous.get(shape)
        if previous is None or rho == 0.0:
            field = fresh
        else:
            field = rho * previous + np.sqrt(1.0 - rho * rho) * fresh
        self._previous[shape] = field
        return field

    def amplitude_map(self, image: np.ndarray) -> np.ndarray:
        """Per-pixel grain standard deviation as a function of luminance."""
        lum = np.asarray(_luminance(image), dtype=np.float64)
        cfg = self.config
        lum_g = np.power(lum, cfg.gamma)
        tone_gain = (cfg.shadow_gain +
                     (cfg.highlight_gain - cfg.shadow_gain) * lum_g)
        return cfg.intensity * tone_gain * lum_g

    def apply(self, image: np.ndarray) -> np.ndarray:
        """Add grain to one display-referred frame.

        Zero intensity returns the exact input object without copying.
        Pure black pixels (luminance 0) are returned bit-exact because their
        amplitude is zero.
        """
        if self.config.intensity == 0.0:
            return image

        image = np.asarray(image, dtype=np.float64)
        amplitude = self.amplitude_map(image)
        field = self._next_field(amplitude.shape)
        perturbation = field * amplitude

        if image.ndim == 3:
            perturbation = perturbation[..., np.newaxis]
        out = image + perturbation
        return np.clip(out, 0.0, 1.0)


def add_grain(image: np.ndarray, config: GrainConfig | None = None,
              **kwargs) -> np.ndarray:
    """Convenience one-shot wrapper around :class:`FilmGrain`."""
    processor = FilmGrain(config, **kwargs) if config is not None \
        else FilmGrain(**kwargs)
    return processor.apply(image)
