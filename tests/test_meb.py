import numpy as np
import pytest

from meb import DynamicMEB, meb_approx, meb_exact
from meb.core import ball_from_support

RNG = np.random.default_rng(42)


# ------------------------------------------------------------ exact solver
def test_two_points():
    pts = np.array([[0.0, 0, 0], [4.0, 0, 0]])
    b = meb_exact(pts)
    assert b.radius == pytest.approx(2.0)
    assert np.allclose(b.center, [2, 0, 0])


def test_tetrahedron():
    pts = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], float)
    b = meb_exact(pts)
    # MEB is determined by the 3 non-origin vertices (origin lies inside
    # their circumball): r = sqrt(2/3), center (1/3, 1/3, 1/3)
    assert b.radius == pytest.approx(np.sqrt(2.0 / 3.0))
    assert np.allclose(b.center, [1 / 3, 1 / 3, 1 / 3], atol=1e-9)


def test_cube_vertices():
    pts = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1)
                    for z in (-1, 1)], float)
    b = meb_exact(pts)
    assert b.radius == pytest.approx(np.sqrt(3))
    assert len(b.support) <= 4


def test_collinear():
    pts = np.column_stack([np.linspace(-3, 5, 80), np.zeros(80), np.zeros(80)])
    b = meb_exact(pts)
    assert b.radius == pytest.approx(4.0)
    assert np.allclose(b.center, [1, 0, 0], atol=1e-8)
    assert len(b.support) == 2


def test_coplanar_circle():
    t = np.linspace(0, 2 * np.pi, 60, endpoint=False)
    pts = np.column_stack([np.cos(t), np.sin(t), np.zeros(60)])
    b = meb_exact(pts)
    assert b.radius == pytest.approx(1.0, abs=1e-9)
    assert np.allclose(b.center, 0, atol=1e-9)


def test_duplicate_points():
    pts = np.vstack([np.zeros((20, 3)), np.ones((20, 3)) * 2, [[1, 1, 1]]])
    b = meb_exact(pts)
    assert b.radius == pytest.approx(np.sqrt(3))
    assert np.allclose(b.center, [1, 1, 1])


def test_extreme_scale():
    pts = np.vstack([np.eye(3) * 1e8, -np.eye(3) * 1e-8, [[0, 0, 0]]])
    b = meb_exact(pts)
    assert b.radius == pytest.approx(1e8 * np.sqrt(2.0 / 3.0), rel=1e-9)
    ba = meb_approx(pts, eps=1e-6)
    assert ba.max_violation(pts) <= 0
    assert ba.radius >= b.radius * (1 - 1e-9)


def test_obtuse_triangle_uses_edge():
    pts = np.array([[0, 0, 0], [4, 0, 0], [1, 0.5, 0]], float)
    b = meb_exact(pts)
    assert b.radius == pytest.approx(2.0)
    assert np.allclose(b.center, [2, 0, 0])


def test_random_matches_brute_property():
    pts = RNG.normal(size=(300, 3))
    b = meb_exact(pts)
    assert b.max_violation(pts) <= 1e-9 * max(1.0, b.radius)
    # radius equals the ball through its support set
    sb = ball_from_support(pts, b.support)
    assert sb.radius == pytest.approx(b.radius, rel=1e-9)


# ------------------------------------------------------------ approx solver
def test_approx_contains_all_and_close():
    for seed in range(5):
        pts = np.random.default_rng(seed).normal(size=(2000, 3))
        be = meb_exact(pts)
        ba = meb_approx(pts, eps=1e-3)
        assert ba.max_violation(pts) <= 0, "approx ball must contain all points"
        assert ba.radius >= be.radius - 1e-9 * max(1.0, be.radius)
        assert (ba.radius - be.radius) / be.radius < 0.02


def test_approx_degenerate():
    pts = np.column_stack([np.linspace(0, 10, 100), np.zeros(100), np.zeros(100)])
    ba = meb_approx(pts, eps=1e-4)
    assert ba.max_violation(pts) <= 0
    assert ba.radius == pytest.approx(5.0, rel=1e-2)


# ------------------------------------------------------------ dynamic
def test_dynamic_add_move_remove():
    dyn = DynamicMEB(mode="exact")
    ids = dyn.add_points(RNG.normal(size=(50, 3)))
    dyn.update()
    r1 = dyn.ball.radius

    inside = np.array([[0.01, 0.01, 0.01]])
    dyn.add_points(inside)
    rep = dyn.update()
    assert not rep.rebuilt and dyn.ball.radius == r1

    dyn.add_points([[10.0, 0, 0]])
    rep = dyn.update()
    assert rep.rebuilt and dyn.ball.radius > r1

    support = dyn.support_ids
    assert len(support) >= 2
    r_big = dyn.ball.radius
    dyn.remove_points([i for i in support])
    rep = dyn.update()
    assert rep.rebuilt, "removing a support point must trigger rebuild"
    assert dyn.ball.radius < r_big, "ball must shrink, not keep stale radius"
    assert dyn.containment_error() <= 1e-9 * max(1.0, dyn.ball.radius)


def test_dynamic_move_support_rebuilds():
    dyn = DynamicMEB(mode="exact")
    dyn.add_points(np.array([[0, 0, 0], [4, 0, 0], [1, 0.5, 0]], float))
    dyn.update()
    assert dyn.ball.radius == pytest.approx(2.0)
    sid = dyn.support_ids[0]
    dyn.move_points([sid], [[100.0, 0, 0]])
    rep = dyn.update()
    assert rep.rebuilt
    assert dyn.containment_error() <= 1e-9 * max(1.0, dyn.ball.radius)
    dyn.remove_points([sid])
    dyn.update()
    assert dyn.ball.radius < 2.0  # stale big ball must be gone


def test_dynamic_approx_always_contains():
    dyn = DynamicMEB(mode="approx", eps=1e-3)
    pts = RNG.normal(size=(5000, 3))
    ids = dyn.add_points(pts)
    dyn.update()
    assert dyn.containment_error() <= 1e-9 * max(1.0, dyn.ball.radius)
    for k in range(5):
        batch = RNG.normal(size=(200, 3)) * (1 + k)
        dyn.add_points(batch)
        dyn.update()
        assert dyn.containment_error() <= 1e-9 * max(1.0, dyn.ball.radius)
    # delete current support points -> rebuild, still contains everything
    dyn.remove_points(dyn.support_ids)
    rep = dyn.update()
    assert rep.rebuilt
    assert dyn.containment_error() <= 1e-9 * max(1.0, dyn.ball.radius)


def test_dynamic_non_support_delete_fast_path():
    dyn = DynamicMEB(mode="exact")
    ids = dyn.add_points(RNG.normal(size=(100, 3)))
    dyn.update()
    keep = set(dyn.support_ids)
    victim = next(i for i in ids if i not in keep)
    r = dyn.ball.radius
    dyn.remove_points([victim])
    rep = dyn.update()
    assert not rep.rebuilt
    assert dyn.ball.radius == r
