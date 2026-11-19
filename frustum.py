from __future__ import annotations

from array import array
from dataclasses import dataclass
import math
import struct


Vec3 = tuple[float, float, float]
Mat4 = tuple[float, ...]

CULL_EPSILON = 2.0e-5
INDIRECT_COMMAND_BYTES = 5 * 4


def f32(value: float) -> float:
    return struct.unpack("=f", struct.pack("=f", value))[0]


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def normalize(v: Vec3) -> Vec3:
    length = math.sqrt(dot(v, v))
    if length <= 1.0e-20:
        raise ValueError("cannot normalize a zero-length vector")
    return (v[0] / length, v[1] / length, v[2] / length)


def mat_mul(a: Mat4, b: Mat4) -> Mat4:
    return tuple(
        sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
        for col in range(4)
        for row in range(4)
    )


def transform_point(matrix: Mat4, point: Vec3) -> Vec3:
    x, y, z = point
    return (
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    )


@dataclass(frozen=True)
class Plane:
    nx: float
    ny: float
    nz: float
    d: float

    def signed_distance(self, point: Vec3) -> float:
        return self.nx * point[0] + self.ny * point[1] + self.nz * point[2] + self.d


@dataclass(frozen=True)
class Sphere:
    center: Vec3
    radius: float


def perspective(fov_y: float, aspect: float, near: float, far: float) -> Mat4:
    focal = 1.0 / math.tan(fov_y * 0.5)
    return (
        focal / aspect,
        0.0,
        0.0,
        0.0,
        0.0,
        focal,
        0.0,
        0.0,
        0.0,
        0.0,
        (far + near) / (near - far),
        -1.0,
        0.0,
        0.0,
        (2.0 * far * near) / (near - far),
        0.0,
    )


def look_at(eye: Vec3, target: Vec3, up: Vec3) -> tuple[Mat4, Vec3, Vec3, Vec3]:
    forward = normalize((target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]))
    right = normalize(cross(forward, up))
    camera_up = cross(right, forward)
    view = (
        right[0],
        camera_up[0],
        -forward[0],
        0.0,
        right[1],
        camera_up[1],
        -forward[1],
        0.0,
        right[2],
        camera_up[2],
        -forward[2],
        0.0,
        -dot(right, eye),
        -dot(camera_up, eye),
        dot(forward, eye),
        1.0,
    )
    return view, right, camera_up, forward


@dataclass(frozen=True)
class Camera:
    eye: Vec3
    target: Vec3
    up: Vec3
    fov_y: float
    aspect: float
    near: float
    far: float

    def matrices(self) -> tuple[Mat4, Mat4, Mat4, Vec3, Vec3, Vec3]:
        view, right, camera_up, forward = look_at(self.eye, self.target, self.up)
        projection = perspective(self.fov_y, self.aspect, self.near, self.far)
        return view, projection, mat_mul(projection, view), right, camera_up, forward


_FACE_CORNER_INDICES = (
    (0, 2, 6, 4),
    (1, 3, 7, 5),
    (0, 1, 5, 4),
    (2, 3, 7, 6),
    (0, 1, 3, 2),
    (4, 5, 7, 6),
)


@dataclass(frozen=True)
class Frustum:
    camera: Camera
    planes: tuple[Plane, ...]
    corners: tuple[Vec3, ...]
    view_projection: Mat4

    @classmethod
    def from_camera(cls, camera: Camera) -> "Frustum":
        view, _, view_projection, right, camera_up, forward = camera.matrices()
        del view
        half_height = math.tan(camera.fov_y * 0.5)
        corners: list[Vec3] = []
        for depth in (camera.near, camera.far):
            for y_ndc in (-1.0, 1.0):
                for x_ndc in (-1.0, 1.0):
                    x = x_ndc * half_height * camera.aspect * depth
                    y = y_ndc * half_height * depth
                    corners.append(
                        (
                            camera.eye[0] + right[0] * x + camera_up[0] * y + forward[0] * depth,
                            camera.eye[1] + right[1] * x + camera_up[1] * y + forward[1] * depth,
                            camera.eye[2] + right[2] * x + camera_up[2] * y + forward[2] * depth,
                        )
                    )

        centroid = tuple(sum(p[i] for p in corners) / 8.0 for i in range(3))
        rows = [[view_projection[col * 4 + row] for col in range(4)] for row in range(4)]
        raw_planes = (
            [rows[0][i] + rows[3][i] for i in range(4)],
            [rows[3][i] - rows[0][i] for i in range(4)],
            [rows[1][i] + rows[3][i] for i in range(4)],
            [rows[3][i] - rows[1][i] for i in range(4)],
            [rows[2][i] + rows[3][i] for i in range(4)],
            [rows[3][i] - rows[2][i] for i in range(4)],
        )

        planes: list[Plane] = []
        for coefficients in raw_planes:
            normal = normalize((coefficients[0], coefficients[1], coefficients[2]))
            distance = coefficients[3] / math.sqrt(sum(coefficients[i] ** 2 for i in range(3)))
            if dot(normal, centroid) + distance < 0.0:
                normal = (-normal[0], -normal[1], -normal[2])
                distance = -distance
            planes.append(
                Plane(f32(normal[0]), f32(normal[1]), f32(normal[2]), f32(distance))
            )

        return cls(
            camera=camera,
            planes=tuple(planes),
            corners=tuple(corners),
            view_projection=tuple(f32(value) for value in view_projection),
        )

    def face_center(self, plane_index: int) -> Vec3:
        indices = _FACE_CORNER_INDICES[plane_index]
        return tuple(
            sum(self.corners[index][axis] for index in indices) / 4.0
            for axis in range(3)
        )

    def face_point(self, plane_index: int, u: float, v: float) -> Vec3:
        p0, p1, p2, p3 = (self.corners[index] for index in _FACE_CORNER_INDICES[plane_index])
        return tuple(
            p0[axis]
            + u * (p1[axis] - p0[axis])
            + v * (p3[axis] - p0[axis])
            + u * v * (p2[axis] - p1[axis] - p3[axis] + p0[axis])
            for axis in range(3)
        )


def sphere_visible(
    sphere: Sphere,
    planes: tuple[Plane, ...],
    epsilon: float = CULL_EPSILON,
) -> bool:
    for plane in planes:
        if plane.signed_distance(sphere.center) < -sphere.radius - epsilon:
            return False
    return True


def visible_sphere_ids(
    spheres: list[Sphere],
    planes: tuple[Plane, ...],
    epsilon: float = CULL_EPSILON,
) -> list[int]:
    return [
        index
        for index, sphere in enumerate(spheres)
        if sphere_visible(sphere, planes, epsilon)
    ]


def pack_spheres(spheres: list[Sphere]) -> array:
    values = array("f")
    for sphere in spheres:
        values.extend(
            (
                f32(sphere.center[0]),
                f32(sphere.center[1]),
                f32(sphere.center[2]),
                f32(sphere.radius),
            )
        )
    return values


def pack_planes(planes: tuple[Plane, ...]) -> array:
    values = array("f")
    for plane in planes:
        values.extend((plane.nx, plane.ny, plane.nz, plane.d))
    return values


class CapacityError(ValueError):
    pass


@dataclass(frozen=True)
class CapacityReport:
    instance_count: int
    instance_capacity: int
    visible_capacity: int
    indirect_bytes: int

    def describe(self) -> str:
        return (
            f"instances {self.instance_count}/{self.instance_capacity}, "
            f"visible-index slots {self.visible_capacity}, "
            f"indirect command {self.indirect_bytes} bytes"
        )


def check_capacity(
    instance_count: int,
    instance_capacity: int,
    visible_capacity: int,
    indirect_bytes: int = INDIRECT_COMMAND_BYTES,
) -> CapacityReport:
    if instance_count < 0:
        raise CapacityError("instance count cannot be negative")
    if instance_count > instance_capacity:
        raise CapacityError(
            f"instance capacity exceeded: {instance_count} > {instance_capacity}"
        )
    if visible_capacity < instance_count:
        raise CapacityError(
            "visible-index capacity must cover every instance because all instances "
            f"may be visible: {visible_capacity} < {instance_count}"
        )
    if indirect_bytes < INDIRECT_COMMAND_BYTES:
        raise CapacityError(
            f"indirect command buffer needs {INDIRECT_COMMAND_BYTES} bytes, got {indirect_bytes}"
        )
    return CapacityReport(
        instance_count=instance_count,
        instance_capacity=instance_capacity,
        visible_capacity=visible_capacity,
        indirect_bytes=indirect_bytes,
    )
