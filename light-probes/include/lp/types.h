#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace lp {

struct Vec3 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;

    constexpr Vec3() = default;
    constexpr Vec3(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}

    constexpr Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    constexpr Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    constexpr Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }

    constexpr float operator[](int axis) const {
        return axis == 0 ? x : (axis == 1 ? y : z);
    }
    float& operator[](int axis) {
        return axis == 0 ? x : (axis == 1 ? y : z);
    }

    static float dot(const Vec3& a, const Vec3& b) {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }
    static Vec3 cross(const Vec3& a, const Vec3& b) {
        return {a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x};
    }
    float length() const { return std::sqrt(dot(*this, *this)); }
};

// HDR linear color in physical/linear units. Separate exposure metadata is kept
// per probe so differently-exposed probes can be normalized before blending.
struct Rgb {
    float r = 0.0f;
    float g = 0.0f;
    float b = 0.0f;

    constexpr Rgb() = default;
    constexpr Rgb(float r_, float g_, float b_) : r(r_), g(g_), b(b_) {}

    constexpr Rgb operator+(const Rgb& o) const { return {r + o.r, g + o.g, b + o.b}; }
    constexpr Rgb operator-(const Rgb& o) const { return {r - o.r, g - o.g, b - o.b}; }
    constexpr Rgb operator*(float s) const { return {r * s, g * s, b * s}; }
    Rgb& operator+=(const Rgb& o) { r += o.r; g += o.g; b += o.b; return *this; }

    static Rgb mul(const Rgb& c, float s) { return c * s; }
    float maxComponent() const { return std::max({r, g, b}); }
};

// Axis-aligned box used to describe solid geometry such as walls.
struct Box {
    Vec3 min;
    Vec3 max;

    bool contains(const Vec3& p) const {
        return p.x >= min.x && p.x <= max.x &&
               p.y >= min.y && p.y <= max.y &&
               p.z >= min.z && p.z <= max.z;
    }

    // Slab intersection. Returns t > eps for the nearest entry, or -1 when the
    // open segment (origin, origin + tMax * dir) does not hit the box.
    float raycast(const Vec3& origin, const Vec3& dir, float tMax, float eps = 1e-5f) const {
        float tMin = 0.0f;
        float tBound = tMax;
        for (int axis = 0; axis < 3; ++axis) {
            if (std::fabs(dir[axis]) < eps) {
                if (origin[axis] < min[axis] || origin[axis] > max[axis]) return -1.0f;
                continue;
            }
            float inv = 1.0f / dir[axis];
            float t1 = (min[axis] - origin[axis]) * inv;
            float t2 = (max[axis] - origin[axis]) * inv;
            if (t1 > t2) std::swap(t1, t2);
            tMin = std::max(tMin, t1);
            tBound = std::min(tBound, t2);
            if (tMin > tBound) return -1.0f;
        }
        if (tMin > eps && tMin < tMax - eps) return tMin;
        return -1.0f;
    }

    // True when the open segment a->b passes through solid volume. Endpoints
    // embedded in the wall are tolerated via epsilon offsets.
    bool blocksLineOfSight(const Vec3& a, const Vec3& b, float eps = 1e-4f) const {
        Vec3 delta = b - a;
        float len = delta.length();
        if (len <= eps) return false;
        Vec3 dir = delta * (1.0f / len);
        Vec3 from = a + dir * eps;
        Vec3 to = b - dir * eps;
        Vec3 span = to - from;
        float tMax = span.length();
        if (tMax <= eps) return false;
        return raycast(from, span * (1.0f / tMax), tMax, 1e-6f) >= 0.0f;
    }
};

} // namespace lp
