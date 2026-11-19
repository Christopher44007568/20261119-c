"""Demo CLI for the Laplacian eigenbasis mesh compressor.

Runs three experiments on a synthetic two-component mesh:

1. sweep:    reconstruction error and storage vs. basis count k
2. bands:    coarse/detail separation by reconstructing frequency bands
3. shuffle:  vertex-order permutation must fail validation
"""

from __future__ import annotations

import argparse

import numpy as np

from mesh_spectral import (
    MeshValidationError,
    compare_basis_counts,
    compute_eigenbasis,
    count_connected_components,
    decode,
    encode,
    reconstruct_band,
    reconstruction_errors,
    two_component_mesh,
    validate_mesh,
)
from mesh_spectral.laplacian import cotangent_laplacian


def make_deformation(mesh, seed=7):
    """Low-frequency bend + high-frequency per-vertex detail."""
    rng = np.random.default_rng(seed)
    p = mesh.positions
    coarse = np.column_stack(
        [
            0.25 * np.sin(p[:, 2] * 1.5),
            0.15 * np.cos(p[:, 0] * 0.8),
            0.10 * np.sin(p[:, 0] + p[:, 1]),
        ]
    )
    detail = 0.02 * rng.standard_normal(p.shape)
    return p + coarse + detail


def sweep(mesh, deformed, ks):
    print("== basis-count sweep (error vs storage) ==")
    rows = compare_basis_counts(mesh, deformed, ks, basis_cache={})
    header = (
        f"{'k':>5} {'RMSE':>12} {'max err':>12} {'payload B':>10} "
        f"{'total B':>10} {'raw B':>10} {'total/raw':>10} {'payload/raw':>11}"
    )
    print(header)
    for r in rows:
        print(
            f"{r['k']:>5} {r['rmse']:>12.6f} {r['max']:>12.6f} "
            f"{r['payload_bytes']:>10} {r['total_bytes']:>10} "
            f"{r['raw_bytes']:>10} {r['ratio']:>10.3f} "
            f"{r['payload_bytes'] / r['raw_bytes']:>11.3f}"
        )
    print("(total includes the once-declared reference mesh + faces; "
          "payload is the per-frame cost)\n")


def bands(mesh, deformed, k, edges):
    print(f"== frequency-band separation (k={k}) ==")
    basis = compute_eigenbasis(mesh, k)
    enc = encode(mesh, deformed, k, basis=basis)
    displacement = deformed - mesh.positions
    _, mass = cotangent_laplacian(mesh)
    md = mass @ displacement
    total_energy = float(np.sum(md * displacement))  # mass-norm energy
    coeffs = enc.coefficients.astype(np.float64)
    print(f"{'band':>10} {'M-energy':>12} {'share':>8} {'cum. share':>11} "
          f"{'cum. RMSE':>10}")
    cum_energy = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        hi = min(hi, k)
        energy = float(np.sum(coeffs[lo:hi] ** 2))  # U is M-orthonormal
        cum_energy += energy
        recon = reconstruct_band(enc, 0, hi, basis=basis)
        err = reconstruction_errors(deformed, recon)
        print(
            f"[{lo:>3},{hi:>3}) {energy:>12.6f} {energy / total_energy:>8.2%} "
            f"{cum_energy / total_energy:>11.2%} {err['rmse']:>10.6f}"
        )
    print("low bands carry the coarse shape; high bands carry the detail\n")


def shuffle_check(mesh, deformed, k, seed=3):
    print("== vertex-order shuffle must fail validation ==")
    enc = encode(mesh, deformed, k)
    rng = np.random.default_rng(seed)
    perm = rng.permutation(mesh.n_vertices)
    shuffled = mesh.permuted(perm)
    try:
        validate_mesh(enc, shuffled)
    except MeshValidationError as exc:
        print(f"shuffled mesh rejected as expected: {exc}")
    else:
        print("ERROR: shuffled mesh was accepted (this must not happen)")
    validate_mesh(enc, mesh)
    print("original-order mesh accepted\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ks", type=int, nargs="+",
                        default=[4, 8, 16, 32, 64, 128])
    parser.add_argument("--band-k", type=int, default=64)
    parser.add_argument("--band-edges", type=int, nargs="+",
                        default=[0, 2, 8, 32, 64])
    args = parser.parse_args()

    mesh = two_component_mesh()
    n_comp = count_connected_components(mesh)
    print(f"mesh: {mesh.n_vertices} vertices, {mesh.n_faces} faces, "
          f"{n_comp} connected components")
    basis = compute_eigenbasis(mesh, max(args.ks))
    n_zero = basis.n_zero_eigenvalues()
    print(f"zero eigenvalues in basis: {n_zero} "
          f"(one per connected component: {n_zero == n_comp})\n")

    deformed = make_deformation(mesh)
    sweep(mesh, deformed, args.ks)
    bands(mesh, deformed, args.band_k, args.band_edges)
    shuffle_check(mesh, deformed, 32)

    enc = encode(mesh, deformed, args.band_k)
    err = reconstruction_errors(deformed, decode(enc))
    print(f"decode sanity at k={args.band_k}: RMSE={err['rmse']:.6f}")


if __name__ == "__main__":
    main()
