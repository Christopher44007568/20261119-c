#pragma once
#include <cmath>
#include <cstdint>
#include <algorithm>

struct v2 {
    float x = 0.f, y = 0.f;
    v2() = default;
    v2(float x_, float y_) : x(x_), y(y_) {}
};

inline v2 operator+(v2 a, v2 b) { return {a.x + b.x, a.y + b.y}; }
inline v2 operator-(v2 a, v2 b) { return {a.x - b.x, a.y - b.y}; }
inline v2 operator*(v2 a, float s) { return {a.x * s, a.y * s}; }

struct v3 {
    float x = 0.f, y = 0.f, z = 0.f;
    v3() = default;
    v3(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}

    float& operator[](int i) { return (&x)[i]; }
    float operator[](int i) const { return (&x)[i]; }
};

inline v3 operator+(v3 a, v3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline v3 operator-(v3 a, v3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline v3 operator-(v3 a) { return {-a.x, -a.y, -a.z}; }
inline v3 operator*(v3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline v3 operator*(float s, v3 a) { return a * s; }
inline v3 operator/(v3 a, float s) { return a * (1.f / s); }
inline v3& operator+=(v3& a, v3 b) { a = a + b; return a; }

inline float dot(v3 a, v3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline v3 cross(v3 a, v3 b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline float length(v3 a) { return std::sqrt(dot(a, a)); }
inline float length2(v3 a) { return dot(a, a); }
inline v3 normalize(v3 a) {
    float len = length(a);
    return len > 0.f ? a / len : v3{0.f, 0.f, 0.f};
}
inline v3 lerp(v3 a, v3 b, float t) { return a + (b - a) * t; }

inline float det2(v2 a, v2 b) { return a.x * b.y - a.y * b.x; }

// Rotate a 2D vector around the origin by angle (radians).
inline v2 rotate2(v2 p, float angle) {
    float c = std::cos(angle), s = std::sin(angle);
    return {c * p.x - s * p.y, s * p.x + c * p.y};
}

// Column-major 3x3, columns are the TBN basis vectors.
struct m3 {
    v3 c0{1, 0, 0}, c1{0, 1, 0}, c2{0, 0, 1};
    m3() = default;
    m3(v3 t, v3 b, v3 n) : c0(t), c1(b), c2(n) {}
};

inline v3 mul(const m3& m, v3 p) {
    return m.c0 * p.x + m.c1 * p.y + m.c2 * p.z;
}

inline float clampf(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}

// Rotate vector p around unit axis k by angle (radians), Rodrigues form.
inline v3 rotateAxis(v3 p, v3 k, float angle) {
    float c = std::cos(angle), s = std::sin(angle);
    return p * c + cross(k, p) * s + k * dot(k, p) * (1.f - c);
}

inline bool finite3(v3 a) {
    return std::isfinite(a.x) && std::isfinite(a.y) && std::isfinite(a.z);
}
