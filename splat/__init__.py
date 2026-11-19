"""Screen-space elliptical Gaussian splat renderer.

Modules:
    camera       -- pinhole camera model and point projection
    covariance   -- 3D covariance repair and EWA 3D->2D projection
    rasterize    -- per-pixel elliptical splat evaluation with alpha blending
    reference    -- small-scale CPU Gauss-Legendre elliptical integral
    scene        -- continuous-surface samplings at controlled densities
    corrections  -- correction record bookkeeping for degenerate covariance
"""

from .camera import Camera
from .covariance import (
    project_covariances,
    repair_covariances_3d,
    CovarianceConfig,
)
from .rasterize import render, RasterConfig
from .reference import reference_render, elliptical_integral, gauss_legendre_2d
from .corrections import CorrectionLog

__all__ = [
    "Camera",
    "project_covariances",
    "repair_covariances_3d",
    "CovarianceConfig",
    "render",
    "RasterConfig",
    "reference_render",
    "elliptical_integral",
    "gauss_legendre_2d",
    "CorrectionLog",
]
