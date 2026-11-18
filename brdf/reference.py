"""Independent direct numerical reference for the environment BRDF integral.

Method: deterministic tensor-product midpoint quadrature over half-vector
spherical coordinates (theta_h, phi_h) with exact solid-angle cell weights,
evaluating
    A, B = Integral_H D * G1(L) * VdotH / (NdotV*(1-k)+k) * (1-Fc, Fc) dWh
which is the environment BRDF integral after the H-space substitution
dWl = 4*VdotH*dWh (the 1/NdotV singularity cancels analytically against
the Smith G1 factor). No importance sampling, no low-discrepancy mapping
of the NDF - a plain Riemann grid, independent of `integrator.py`.

The H-space domain is essential: at grazing view the L-space lobe is an
ellipse compressed by ~NdotV in one axis (down to 1e-7 rad), which no
isotropic L-space grid can resolve, while the H-space lobe stays an
isotropic ~roughness^2 bump around N. The polar angle is warped
cubically, theta = (pi/2) * u^3, so cells near N shrink below 1e-7 rad.

The roughness -> 0 mirror limit is applied as a closed form.
"""

import numpy as np

from .integrator import ROUGHNESS_LIMIT, mirror_limit


def _h_grid(n_theta, n_phi):
    """Midpoint grid on the H hemisphere; returns (dirs (n,3), weights (n,))."""
    u_in = np.arange(n_theta) / n_theta
    u_out = np.arange(1, n_theta + 1) / n_theta
    th_in = 0.5 * np.pi * u_in**3
    th_out = 0.5 * np.pi * u_out**3
    theta = 0.5 * np.pi * ((u_in + u_out) * 0.5) ** 3  # (T,)
    w_theta = (2.0 * np.pi / n_phi) * (np.cos(th_in) - np.cos(th_out))
    phi = 2.0 * np.pi * (np.arange(n_phi) + 0.5) / n_phi  # (P,)
    th_g, ph_g = np.meshgrid(theta, phi, indexing="ij")
    dirs = np.stack(
        [
            np.sin(th_g) * np.cos(ph_g),
            np.sin(th_g) * np.sin(ph_g),
            np.cos(th_g),
        ],
        axis=-1,
    ).reshape(-1, 3)
    return dirs, np.repeat(w_theta, n_phi)


def _reference_single(nv, rough, n_theta, n_phi):
    a = rough * rough
    a2 = max(a * a, 1e-12)
    k = 0.5 * a
    v = np.array([np.sqrt(max(0.0, 1.0 - nv * nv)), 0.0, nv])
    h, w = _h_grid(n_theta, n_phi)
    nh = h[:, 2]
    vh = np.clip(h @ v, 0.0, 1.0)
    nl = 2.0 * vh * nh - nv  # L = 2(V.H)H - V, z-component
    d = a2 / (np.pi * ((a2 - 1.0) * nh * nh + 1.0) ** 2)
    nl_c = np.clip(nl, 0.0, 1.0)
    g1_l = nl_c / (nl_c * (1.0 - k) + k)
    fc = (1.0 - vh) ** 5
    common = d * g1_l * vh / max(nv * (1.0 - k) + k, 1e-12)
    common = np.where((nl > 0.0) & (vh > 0.0), common, 0.0) * w
    return np.sum(common * (1.0 - fc)), np.sum(common * fc)


def integrate_brdf_reference(ndotv, roughness, n_theta=4096, n_phi=512):
    """Reference (A, B); scalar or equal-shaped array inputs.

    n_theta/n_phi are the *maximum* grid sizes; the actual grid adapts to
    the lobe width a = roughness^2 (cells near N must stay well below a).
    """
    ndotv = np.clip(np.asarray(ndotv, dtype=np.float64), 0.0, 1.0)
    rough_c = np.clip(np.asarray(roughness, dtype=np.float64), 0.0, 1.0)
    shape = np.broadcast(ndotv, rough_c).shape
    nv_f = np.broadcast_to(ndotv, shape).ravel()
    rr_f = np.broadcast_to(rough_c, shape).ravel()
    a_out = np.empty_like(nv_f)
    b_out = np.empty_like(nv_f)
    for i in range(nv_f.size):
        if rr_f[i] < ROUGHNESS_LIMIT:
            am, bm = mirror_limit(nv_f[i])
            a_out[i], b_out[i] = am, bm
        else:
            a = max(rr_f[i], ROUGHNESS_LIMIT) ** 2
            nt = int(np.clip(100.0 * a ** (-1.0 / 3.0), 128, n_theta))
            np_ = int(np.clip(nt // 8, 32, n_phi))
            a_out[i], b_out[i] = _reference_single(
                nv_f[i], max(rr_f[i], ROUGHNESS_LIMIT), nt, np_
            )
    return a_out.reshape(shape), b_out.reshape(shape)
