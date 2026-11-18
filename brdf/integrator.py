"""Split-sum environment BRDF integrator (Karis 2013, GGX/Smith, IBL k=a/2).

Computes the 2D LUT over (NdotV, roughness):
    reflected = A * F0 + B
where (A, B) = Integral[ D*G*F*(NdotL)/(4*NdotL*NdotV) dL ] split on the
Schlick Fresnel F = F0 + (1-F0)*(1-VdotH)^5.

Boundary limits are handled explicitly:
  * NdotV -> 0 is a *removable* singularity: the 1/NdotV in G_Vis cancels
    analytically against the NdotV factor of the Smith G1 term,
        G_Vis = G1(L) * VdotH / (NdotH * (NdotV*(1-k) + k)),
    so the integrand is evaluated directly at its finite limit. Numerically
    the integral converges to a nonzero constant (e.g. A ~= 0.701 at
    roughness 0.5), NOT to (0, 1).
  * roughness -> 0 is a genuine delta limit: D collapses onto H = N and
    (A, B) -> (1 - (1-NdotV)^5, (1-NdotV)^5). Below ROUGHNESS_LIMIT the
    closed form is returned instead of the singular quadrature.
"""

import numpy as np

from .sampling import hammersley, importance_sample_ggx

ROUGHNESS_LIMIT = 1e-3


def mirror_limit(ndotv):
    """Closed-form (A, B) at roughness = 0 (perfect mirror)."""
    fc = (1.0 - np.asarray(ndotv, dtype=np.float64)) ** 5
    return 1.0 - fc, fc


def integrate_brdf(ndotv, roughness, num_samples=1024):
    """Vectorized (A, B) for broadcastable (ndotv, roughness) arrays."""
    ndotv = np.clip(np.asarray(ndotv, dtype=np.float64), 0.0, 1.0)
    rough_c = np.clip(np.asarray(roughness, dtype=np.float64), 0.0, 1.0)

    xi = hammersley(np.arange(num_samples), num_samples)  # (S, 2)

    nv = ndotv[..., None]
    rr = np.maximum(rough_c, ROUGHNESS_LIMIT)[..., None]
    a = rr * rr
    k = 0.5 * a  # Karis IBL remapping
    vx = np.sqrt(np.maximum(0.0, 1.0 - nv * nv))
    v = np.stack([vx, np.zeros_like(vx), nv], axis=-1)  # (..., 1, 3)

    h = importance_sample_ggx(xi, rr)  # (..., S, 3)
    vdot = np.sum(v * h, axis=-1)  # (..., S)
    lz = 2.0 * vdot * h[..., 2] - v[..., 2]

    nl = np.clip(lz, 0.0, 1.0)
    nh = np.clip(h[..., 2], 0.0, 1.0)
    vh = np.clip(vdot, 0.0, 1.0)

    g1_l = nl / (nl * (1.0 - k) + k)
    # G_Vis with the NdotV singularity analytically canceled:
    #   G * VdotH / (NdotH * NdotV) = G1(L) * VdotH / (NdotH * (nv*(1-k)+k))
    g_vis = g1_l * vh / np.maximum(nh * (nv * (1.0 - k) + k), 1e-12)
    fc = (1.0 - vh) ** 5
    g_vis = np.where(lz > 0.0, g_vis, 0.0)

    a_out = np.mean((1.0 - fc) * g_vis, axis=-1)
    b_out = np.mean(fc * g_vis, axis=-1)

    am, bm = mirror_limit(ndotv)
    mirror = rough_c < ROUGHNESS_LIMIT
    a_out = np.where(mirror, am, a_out)
    b_out = np.where(mirror, bm, b_out)
    return a_out, b_out


def generate_lut(resolution, num_samples=1024):
    """(resolution, resolution, 2) LUT; u = NdotV, v = roughness.

    Texel centers follow the usual (i + 0.5) / resolution convention.
    Rows are integrated one at a time to bound memory use.
    """
    centers = (np.arange(resolution) + 0.5) / resolution
    lut = np.empty((resolution, resolution, 2), dtype=np.float64)
    for row, rr in enumerate(centers):
        a, b = integrate_brdf(centers, np.full(resolution, rr), num_samples)
        lut[row, :, 0] = a
        lut[row, :, 1] = b
    return lut
