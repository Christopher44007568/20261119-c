import numpy as np
import pytest

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


@pytest.fixture(scope="module")
def mesh():
    return two_component_mesh()


@pytest.fixture(scope="module")
def deformed(mesh):
    rng = np.random.default_rng(0)
    p = mesh.positions
    coarse = np.column_stack(
        [0.2 * np.sin(p[:, 2]), 0.1 * np.cos(p[:, 0]), 0.05 * np.sin(p[:, 1])]
    )
    return p + coarse + 0.01 * rng.standard_normal(p.shape)


def test_zero_eigenvalues_match_components(mesh):
    assert count_connected_components(mesh) == 2
    basis = compute_eigenbasis(mesh, 16)
    assert basis.n_zero_eigenvalues() == 2
    assert basis.eigenvalues[2] > 1e-6


def test_error_decreases_with_k(mesh, deformed):
    rows = compare_basis_counts(mesh, deformed, [4, 16, 64], basis_cache={})
    rmses = [r["rmse"] for r in rows]
    assert rmses[0] > rmses[1] > rmses[2]
    payloads = [r["payload_bytes"] for r in rows]
    assert payloads[0] < payloads[1] < payloads[2]


def test_full_basis_reconstructs(mesh, deformed):
    enc = encode(mesh, deformed, mesh.n_vertices)
    err = reconstruction_errors(deformed, decode(enc))
    assert err["rmse"] < 1e-6


def test_bands_sum_to_full(mesh, deformed):
    k = 32
    basis = compute_eigenbasis(mesh, k)
    enc = encode(mesh, deformed, k, basis=basis)
    lo = reconstruct_band(enc, 0, 8, basis=basis) - mesh.positions
    hi = reconstruct_band(enc, 8, k, basis=basis) - mesh.positions
    full = reconstruct_band(enc, 0, k, basis=basis) - mesh.positions
    assert np.allclose(lo + hi, full, atol=1e-6)


def test_band_energy_concentrated_low(mesh, deformed):
    k = 64
    basis = compute_eigenbasis(mesh, k)
    enc = encode(mesh, deformed, k, basis=basis)
    low = reconstruct_band(enc, 0, 8, basis=basis) - mesh.positions
    high = reconstruct_band(enc, 32, k, basis=basis) - mesh.positions
    assert np.sum(low**2) > 10 * np.sum(high**2)


def test_shuffled_vertex_order_fails(mesh, deformed):
    enc = encode(mesh, deformed, 16)
    rng = np.random.default_rng(1)
    shuffled = mesh.permuted(rng.permutation(mesh.n_vertices))
    with pytest.raises(MeshValidationError):
        validate_mesh(enc, shuffled)
    with pytest.raises(MeshValidationError):
        decode(enc, mesh=shuffled)
    validate_mesh(enc, mesh)


def test_wrong_vertex_count_fails(mesh, deformed):
    from mesh_spectral import Mesh

    enc = encode(mesh, deformed, 8)
    keep = mesh.faces.max(axis=1) < mesh.n_vertices - 1
    smaller = Mesh(mesh.positions[:-1], mesh.faces[keep])
    with pytest.raises(MeshValidationError):
        validate_mesh(enc, smaller)


def test_payload_is_spectral_not_per_vertex(mesh, deformed):
    """The per-frame payload must be k coefficients, not n quantized coords."""
    k = 16
    enc = encode(mesh, deformed, k)
    storage = enc.storage_bytes()
    assert enc.coefficients.shape == (k, 3)
    assert storage["coefficients"] == k * 3 * 4
    assert storage["coefficients"] < mesh.n_vertices * 3 * 4
