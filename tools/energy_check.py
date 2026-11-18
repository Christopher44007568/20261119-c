#!/usr/bin/env python3
"""Energy-distribution check for the clearcoat PBR model.

Mirrors shaders/clearcoat_pbr.glsl and numerically integrates the
directional-hemispherical reflectance  R(wo) = integral of f(wi,wo)*NoL dwi
via stratified Monte Carlo over the incoming hemisphere.

Scenarios:
  1. base-only    -- plain base layer, no coat
  2. coat-only    -- black non-metallic base under a full coat
  3. combined     -- base + coat layered
  4. weight-zero  -- clearcoat = 0 must reproduce base-only exactly

Checks:
  * every scenario conserves energy: R(wo) <= 1 (+ MC tolerance)
  * combined does not stack two full lobes: R_combined <= R_base + R_coat
    and the base part of the combined result is attenuated by the coat
  * clearcoat weight 0 returns exactly to the base layer
  * per-layer reflection terms are recorded and printed
"""

import math
import random
import sys
from dataclasses import dataclass, field

PI = math.pi


@dataclass(frozen=True)
class Material:
    base_color: tuple = (0.8, 0.2, 0.1)
    metallic: float = 0.0
    roughness: float = 0.4
    clearcoat: float = 1.0
    clearcoat_roughness: float = 0.1
    clearcoat_ior: float = 1.5
    clearcoat_thickness: float = 0.0
    clearcoat_absorption: tuple = (0.0, 0.0, 0.0)


@dataclass
class LayerTerms:
    """Multi-layer reflection terms recorded per (wi, wo) evaluation."""
    base_diffuse: tuple = (0.0, 0.0, 0.0)
    base_specular: tuple = (0.0, 0.0, 0.0)
    coat_specular: float = 0.0
    coat_fresnel: float = 0.0
    layer_attenuation: float = 1.0
    absorption: tuple = (1.0, 1.0, 1.0)
    base_through_coat: tuple = (0.0, 0.0, 0.0)
    total: tuple = (0.0, 0.0, 0.0)


def _v3_add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _v3_mul(a, b):
    return (a[0] * b[0], a[1] * b[1], a[2] * b[2])


def _v3_scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def d_ggx(noh, roughness):
    a = roughness * roughness
    a2 = a * a
    d = noh * noh * (a2 - 1.0) + 1.0
    return a2 / (PI * d * d)


def v_smith_ggx_correlated(nov, nol, roughness):
    a2 = roughness * roughness
    gv = nol * math.sqrt(nov * nov * (1.0 - a2) + a2)
    gl = nov * math.sqrt(nol * nol * (1.0 - a2) + a2)
    return 0.5 / max(gv + gl, 1e-6)


def f_schlick(f0, voh):
    t = min(max(1.0 - voh, 0.0), 1.0)
    t5 = t * t * t * t * t
    return f0 + (1.0 - f0) * t5


def f0_from_ior(ior):
    r = (ior - 1.0) / (ior + 1.0)
    return r * r


def eval_base(m, nov, nol, noh, voh):
    """Base layer BRDF (diffuse, specular), pre-attenuation."""
    f0 = tuple(0.04 * (1.0 - m.metallic) + c * m.metallic
               for c in m.base_color)
    fd = tuple((1.0 - m.metallic) * c / PI for c in m.base_color)

    d = d_ggx(noh, m.roughness)
    v = v_smith_ggx_correlated(nov, nol, m.roughness)
    f = tuple(f_schlick(c, voh) for c in f0)

    diffuse = tuple(fd[i] * (1.0 - f[i]) for i in range(3))
    specular = tuple(d * v * f[i] for i in range(3))
    return diffuse, specular


def eval_coat(m, nov, nol, noh, voh):
    """Clearcoat lobe (achromatic dielectric); returns (value, Fc)."""
    f0 = f0_from_ior(m.clearcoat_ior)
    d = d_ggx(noh, m.clearcoat_roughness)
    v = v_smith_ggx_correlated(nov, nol, m.clearcoat_roughness)
    f = f_schlick(f0, voh)
    fc = m.clearcoat * f
    return m.clearcoat * d * v * f, fc


def coat_absorption(m, nov, nol):
    path = m.clearcoat_thickness * (1.0 / max(nov, 1e-4)
                                    + 1.0 / max(nol, 1e-4))
    return tuple(math.exp(-s * path) for s in m.clearcoat_absorption)


def evaluate(m, v, l, terms=None):
    """Dual-layer BRDF * NoL. Normal is +Z; v, l are normalized vectors."""
    h = (v[0] + l[0], v[1] + l[1], v[2] + l[2])
    hl = math.sqrt(h[0] ** 2 + h[1] ** 2 + h[2] ** 2)
    if hl < 1e-9:
        h = (0.0, 0.0, 1.0)
    else:
        h = (h[0] / hl, h[1] / hl, h[2] / hl)

    nov = min(max(v[2], 1e-4), 1.0)
    nol = min(max(l[2], 0.0), 1.0)
    noh = min(max(h[2], 0.0), 1.0)
    voh = min(max(v[0] * h[0] + v[1] * h[1] + v[2] * h[2], 0.0), 1.0)

    coat, fc = eval_coat(m, nov, nol, noh, voh)
    diffuse, specular = eval_base(m, nov, nol, noh, voh)

    attenuation = (1.0 - fc) * (1.0 - fc)
    raw_absorption = coat_absorption(m, nov, nol)
    # Gate absorption on the coat weight: clearcoat = 0 must reproduce the
    # uncoated base layer exactly, regardless of thickness settings.
    absorption = tuple(1.0 + (a - 1.0) * m.clearcoat for a in raw_absorption)
    base_through = tuple((diffuse[i] + specular[i]) * attenuation * absorption[i]
                         for i in range(3))
    total = tuple((base_through[i] + coat) * nol for i in range(3))

    if terms is not None:
        terms.base_diffuse = diffuse
        terms.base_specular = specular
        terms.coat_specular = coat
        terms.coat_fresnel = fc
        terms.layer_attenuation = attenuation
        terms.absorption = absorption
        terms.base_through_coat = base_through
        terms.total = total
    return total


# ---------------------------------------------------------------------------
# Monte Carlo directional-hemispherical reflectance
# ---------------------------------------------------------------------------

def _hemisphere_samples(n, seed=1234):
    """Stratified uniform hemisphere samples (z >= 0)."""
    rng = random.Random(seed)
    side = int(math.sqrt(n))
    for i in range(side):
        for j in range(side):
            u = (i + rng.random()) / side
            w = (j + rng.random()) / side
            z = u
            r = math.sqrt(max(0.0, 1.0 - z * z))
            phi = 2.0 * PI * w
            yield (r * math.cos(phi), r * math.sin(phi), z)


def reflectance(m, wo, n_samples=65536):
    """R(wo) = integral of BRDF(wi,wo) * NoL dwi, per channel.

    Also integrates each layer term separately so the energy split is
    recorded, not just the total.
    """
    acc_total = [0.0, 0.0, 0.0]
    acc_base = [0.0, 0.0, 0.0]
    acc_coat = 0.0
    count = 0
    for wi in _hemisphere_samples(n_samples):
        terms = LayerTerms()
        evaluate(m, wo, wi, terms)
        nol = wi[2]
        for c in range(3):
            acc_total[c] += terms.total[c]
            acc_base[c] += terms.base_through_coat[c] * nol
        acc_coat += terms.coat_specular * nol
        count += 1
    # Uniform hemisphere pdf = 1 / (2*pi)
    scale = 2.0 * PI / count
    total = tuple(a * scale for a in acc_total)
    base = tuple(a * scale for a in acc_base)
    coat = acc_coat * scale
    return total, base, coat


def dir_vec(theta_deg, phi_deg=0.0):
    t = math.radians(theta_deg)
    p = math.radians(phi_deg)
    return (math.sin(t) * math.cos(p), math.sin(t) * math.sin(p), math.cos(t))


# ---------------------------------------------------------------------------
# Scenarios and checks
# ---------------------------------------------------------------------------

MC_TOLERANCE = 0.02  # Monte Carlo integration slack


def check_energy(label, m, view_angles):
    worst = 0.0
    for angle in view_angles:
        total, base, coat = reflectance(m, dir_vec(angle))
        peak = max(total)
        worst = max(worst, peak)
        status = "OK " if peak <= 1.0 + MC_TOLERANCE else "FAIL"
        print(f"  [{status}] {label:10s} view={angle:5.1f}deg  "
              f"R_total=({total[0]:.4f},{total[1]:.4f},{total[2]:.4f})  "
              f"R_base=({base[0]:.4f},{base[1]:.4f},{base[2]:.4f})  "
              f"R_coat={coat:.4f}")
    return worst


def main():
    view_angles = [0.0, 30.0, 60.0, 80.0]
    failures = []

    base_mat = Material(clearcoat=0.0)
    coat_only_mat = Material(base_color=(0.0, 0.0, 0.0), clearcoat=1.0)
    combined_mat = Material(clearcoat=1.0, clearcoat_thickness=0.5,
                            clearcoat_absorption=(0.05, 0.03, 0.02))

    print("== 1. Base layer only (clearcoat weight = 0) ==")
    worst_base = check_energy("base-only", base_mat, view_angles)

    print("== 2. Clearcoat reflection only (black base) ==")
    worst_coat = check_energy("coat-only", coat_only_mat, view_angles)

    print("== 3. Combined base + clearcoat ==")
    worst_combined = check_energy("combined", combined_mat, view_angles)

    for label, worst in (("base-only", worst_base),
                         ("coat-only", worst_coat),
                         ("combined", worst_combined)):
        if worst > 1.0 + MC_TOLERANCE:
            failures.append(f"{label} reflects {worst:.4f} > 1")

    print("== 4. No double-stacking of the two lobes ==")
    for angle in view_angles:
        wo = dir_vec(angle)
        total_c, base_c, coat_c = reflectance(combined_mat, wo)
        total_b, _, _ = reflectance(base_mat, wo)
        _, _, coat_o = reflectance(coat_only_mat, wo)
        naive_sum = tuple(total_b[i] + coat_o for i in range(3))
        for ch in range(3):
            # Layering must remove the coat Fresnel share from the base, so
            # the combined reflectance stays below the naive full sum.
            if total_c[ch] > naive_sum[ch] + MC_TOLERANCE:
                failures.append(
                    f"combined[{ch}] {total_c[ch]:.4f} exceeds naive sum "
                    f"{naive_sum[ch]:.4f} at view {angle}deg")
        # The base part inside the combined result must be attenuated
        # relative to the standalone base layer.
        for ch in range(3):
            if base_c[ch] > total_b[ch] + MC_TOLERANCE:
                failures.append(
                    f"attenuated base[{ch}] {base_c[ch]:.4f} exceeds "
                    f"standalone base {total_b[ch]:.4f} at view {angle}deg")
        print(f"  view={angle:5.1f}deg  combined={max(total_c):.4f}  "
              f"naive_sum={max(naive_sum):.4f}  "
              f"attenuated_base={max(base_c):.4f} vs base={max(total_b):.4f}")

    print("== 5. Clearcoat weight 0 returns to the base layer ==")
    zero_mat = Material(clearcoat=0.0, clearcoat_roughness=0.9,
                        clearcoat_ior=2.4, clearcoat_thickness=3.0,
                        clearcoat_absorption=(0.9, 0.9, 0.9))
    # Absorption/thickness of a zero-weight coat must not matter: the model
    # gates them on the weight, so compare against the plain base layer.
    max_err = 0.0
    for angle in view_angles:
        wo = dir_vec(angle)
        for _ in range(64):
            wi = dir_vec(random.uniform(0, 89), random.uniform(0, 360))
            a = evaluate(zero_mat, wo, wi)
            b = evaluate(base_mat, wo, wi)
            max_err = max(max_err, max(abs(a[i] - b[i]) for i in range(3)))
    status = "OK " if max_err < 1e-9 else "FAIL"
    print(f"  [{status}] max |f(clearcoat=0) - f(base)| = {max_err:.3e}")
    if max_err >= 1e-9:
        failures.append(f"weight-zero mismatch {max_err:.3e}")

    print("== 6. Recorded layer terms (sample direction, combined) ==")
    terms = LayerTerms()
    evaluate(combined_mat, dir_vec(45.0), dir_vec(45.0, 180.0), terms)
    print(f"  coatFresnel       = {terms.coat_fresnel:.4f}")
    print(f"  layerAttenuation  = {terms.layer_attenuation:.4f}")
    print(f"  absorption        = {tuple(round(a, 4) for a in terms.absorption)}")
    print(f"  baseDiffuse       = {tuple(round(v, 4) for v in terms.base_diffuse)}")
    print(f"  baseSpecular      = {tuple(round(v, 4) for v in terms.base_specular)}")
    print(f"  coatSpecular      = {terms.coat_specular:.4f}")
    print(f"  baseThroughCoat   = {tuple(round(v, 4) for v in terms.base_through_coat)}")
    print(f"  total (BRDF*NoL)  = {tuple(round(v, 4) for v in terms.total)}")

    print()
    if failures:
        print(f"FAILED ({len(failures)} problem(s)):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("All energy-distribution checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
