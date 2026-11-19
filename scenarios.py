from __future__ import annotations

from dataclasses import dataclass
import math
import random

from frustum import (
    CULL_EPSILON,
    Camera,
    Frustum,
    Sphere,
    f32,
    sphere_visible,
    visible_sphere_ids,
)


@dataclass(frozen=True)
class Scenario:
    name: str
    description: str
    spheres: list[Sphere]
    expected_ids: list[int]


def _packed_sphere(center: tuple[float, float, float], radius: float) -> Sphere:
    return Sphere(
        (f32(center[0]), f32(center[1]), f32(center[2])),
        f32(radius),
    )


def _inside_with_margin(
    sphere: Sphere,
    frustum: Frustum,
    margin: float,
) -> bool:
    return all(
        plane.signed_distance(sphere.center) >= sphere.radius + margin
        for plane in frustum.planes
    )


def _outside_with_margin(
    sphere: Sphere,
    frustum: Frustum,
    margin: float,
) -> bool:
    return any(
        plane.signed_distance(sphere.center) < -sphere.radius - margin
        for plane in frustum.planes
    )


def _sample_inside(
    rng: random.Random,
    frustum: Frustum,
    camera: Camera,
) -> Sphere:
    _, _, _, right, camera_up, forward = camera.matrices()
    half_height = math.tan(camera.fov_y * 0.5)
    for _ in range(128):
        depth = rng.uniform(camera.near + 0.4, camera.far - 1.0)
        extent_y = half_height * depth
        extent_x = extent_y * camera.aspect
        x = rng.uniform(-0.72, 0.72) * extent_x
        y = rng.uniform(-0.72, 0.72) * extent_y
        radius = rng.uniform(0.004, 0.012)
        center = (
            camera.eye[0] + right[0] * x + camera_up[0] * y + forward[0] * depth,
            camera.eye[1] + right[1] * x + camera_up[1] * y + forward[1] * depth,
            camera.eye[2] + right[2] * x + camera_up[2] * y + forward[2] * depth,
        )
        sphere = _packed_sphere(center, radius)
        if _inside_with_margin(sphere, frustum, 1.0e-3):
            return sphere
    raise RuntimeError("failed to sample an all-visible sphere inside the frustum")


def _sample_outside(
    rng: random.Random,
    frustum: Frustum,
    camera: Camera,
    family: int,
) -> Sphere:
    _, _, _, right, camera_up, forward = camera.matrices()
    half_height = math.tan(camera.fov_y * 0.5)
    for _ in range(128):
        radius = rng.uniform(0.004, 0.015)
        if family == 0:
            depth = -rng.uniform(1.0, 20.0)
            x = rng.uniform(-2.0, 2.0)
            y = rng.uniform(-2.0, 2.0)
        elif family == 1:
            depth = camera.far + rng.uniform(1.0, 40.0)
            x = rng.uniform(-0.5, 0.5) * half_height * depth
            y = rng.uniform(-0.5, 0.5) * half_height * depth
        else:
            depth = rng.uniform(camera.near + 0.5, camera.far)
            extent_y = half_height * depth
            extent_x = extent_y * camera.aspect
            x = rng.choice((-1.0, 1.0)) * rng.uniform(1.4, 2.2) * extent_x
            y = rng.uniform(-1.5, 1.5) * extent_y
        center = (
            camera.eye[0] + right[0] * x + camera_up[0] * y + forward[0] * depth,
            camera.eye[1] + right[1] * x + camera_up[1] * y + forward[1] * depth,
            camera.eye[2] + right[2] * x + camera_up[2] * y + forward[2] * depth,
        )
        sphere = _packed_sphere(center, radius)
        if _outside_with_margin(sphere, frustum, 1.0e-3):
            return sphere
    raise RuntimeError("failed to sample a fully invisible sphere")


def _make_all_visible(
    rng: random.Random,
    frustum: Frustum,
    camera: Camera,
    count: int,
) -> list[Sphere]:
    return [_sample_inside(rng, frustum, camera) for _ in range(count)]


def _make_invisible(
    rng: random.Random,
    frustum: Frustum,
    camera: Camera,
    count: int,
) -> list[Sphere]:
    return [
        _sample_outside(rng, frustum, camera, index % 3)
        for index in range(count)
    ]


def _make_tangent(
    rng: random.Random,
    frustum: Frustum,
    per_face: int,
    radius: float = 0.01,
) -> list[Sphere]:
    spheres: list[Sphere] = []
    packed_radius = f32(radius)
    for plane_index, plane in enumerate(frustum.planes):
        for _ in range(per_face):
            u = rng.uniform(0.22, 0.78)
            v = rng.uniform(0.22, 0.78)
            contact = frustum.face_point(plane_index, u, v)
            center = (
                contact[0] - plane.nx * radius,
                contact[1] - plane.ny * radius,
                contact[2] - plane.nz * radius,
            )
            sphere = _packed_sphere(center, packed_radius)
            if not sphere_visible(sphere, frustum.planes, CULL_EPSILON):
                raise RuntimeError(
                    f"tangent sphere for plane {plane_index} failed CPU culling"
                )
            spheres.append(sphere)
    return spheres


def _scenario(
    name: str,
    description: str,
    spheres: list[Sphere],
    frustum: Frustum,
) -> Scenario:
    return Scenario(
        name=name,
        description=description,
        spheres=spheres,
        expected_ids=visible_sphere_ids(spheres, frustum.planes),
    )


def build_scenarios(
    frustum: Frustum,
    count: int = 262_144,
    near_per_face: int = 1024,
    seed: int = 20261119,
) -> list[Scenario]:
    if count <= 0:
        raise ValueError("count must be positive")
    if near_per_face <= 0:
        raise ValueError("near_per_face must be positive")

    rng = random.Random(seed)
    camera = frustum.camera
    visible = _make_all_visible(rng, frustum, camera, count)
    invisible = _make_invisible(rng, frustum, camera, count)
    tangent = _make_tangent(rng, frustum, near_per_face)

    mixed: list[Sphere] = []
    for index in range(count):
        mixed.append(visible[index] if index % 2 == 0 else invisible[index])
    rng.shuffle(mixed)

    return [
        _scenario(
            "invisible",
            "All bounding spheres are outside the frustum.",
            invisible,
            frustum,
        ),
        _scenario(
            "all-visible",
            "All bounding spheres are fully inside the frustum.",
            visible,
            frustum,
        ),
        _scenario(
            "near-planes",
            "Bounding spheres are externally tangent to each of the six planes.",
            tangent,
            frustum,
        ),
        _scenario(
            "mixed",
            "Half visible and half invisible instances in shuffled order.",
            mixed,
            frustum,
        ),
    ]
