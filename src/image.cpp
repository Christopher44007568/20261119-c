#include "image.h"
#include <fstream>
#include <cmath>
#include <array>

namespace {

// 5x7 glyph bitmaps, each row stored in the low 5 bits (MSB = left).
const std::array<unsigned char, 7>& glyph(char c) {
    static const std::array<unsigned char, 7> blank = {0,0,0,0,0,0,0};
    static const std::array<unsigned char, 7> A = {0x0E,0x11,0x11,0x1F,0x11,0x11,0x11};
    static const std::array<unsigned char, 7> B = {0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E};
    static const std::array<unsigned char, 7> C = {0x0E,0x11,0x10,0x10,0x10,0x11,0x0E};
    static const std::array<unsigned char, 7> D = {0x1C,0x12,0x11,0x11,0x11,0x12,0x1C};
    static const std::array<unsigned char, 7> E = {0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F};
    static const std::array<unsigned char, 7> G = {0x0E,0x11,0x10,0x17,0x11,0x11,0x0F};
    static const std::array<unsigned char, 7> I = {0x1F,0x04,0x04,0x04,0x04,0x04,0x1F};
    static const std::array<unsigned char, 7> L = {0x10,0x10,0x10,0x10,0x10,0x10,0x1F};
    static const std::array<unsigned char, 7> M = {0x11,0x1B,0x15,0x15,0x11,0x11,0x11};
    static const std::array<unsigned char, 7> N = {0x11,0x19,0x15,0x13,0x11,0x11,0x11};
    static const std::array<unsigned char, 7> O = {0x0E,0x11,0x11,0x11,0x11,0x11,0x0E};
    static const std::array<unsigned char, 7> R = {0x1E,0x11,0x11,0x1E,0x14,0x12,0x11};
    static const std::array<unsigned char, 7> S = {0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E};
    static const std::array<unsigned char, 7> T = {0x1F,0x04,0x04,0x04,0x04,0x04,0x04};
    static const std::array<unsigned char, 7> U = {0x11,0x11,0x11,0x11,0x11,0x11,0x0E};
    static const std::array<unsigned char, 7> V = {0x11,0x11,0x11,0x11,0x11,0x0A,0x04};
    static const std::array<unsigned char, 7> Y = {0x11,0x11,0x0A,0x04,0x04,0x04,0x04};
    static const std::array<unsigned char, 7> W = {0x11,0x11,0x11,0x15,0x15,0x1B,0x11};
    static const std::array<unsigned char, 7> H = {0x11,0x11,0x11,0x1F,0x11,0x11,0x11};
    static const std::array<unsigned char, 7> Z = {0x1F,0x01,0x02,0x04,0x08,0x10,0x1F};
    static const std::array<unsigned char, 7> n0 = {0x0E,0x11,0x13,0x15,0x19,0x11,0x0E};
    static const std::array<unsigned char, 7> n1 = {0x04,0x0C,0x04,0x04,0x04,0x04,0x0E};
    static const std::array<unsigned char, 7> dash = {0,0,0,0x1F,0,0,0};
    static const std::array<unsigned char, 7> plus = {0,0x04,0x04,0x1F,0x04,0x04,0};
    static const std::array<unsigned char, 7> colon = {0,0x04,0,0,0,0x04,0};
    switch (c) {
        case 'A': return A; case 'B': return B; case 'C': return C;
        case 'D': return D; case 'E': return E; case 'G': return G;
        case 'I': return I; case 'L': return L; case 'M': return M;
        case 'N': return N; case 'O': return O; case 'R': return R;
        case 'S': return S; case 'T': return T; case 'U': return U;
        case 'V': return V; case 'Y': return Y; case 'W': return W;
        case 'H': return H; case 'Z': return Z;
        case '0': return n0; case '1': return n1;
        case '-': return dash; case '+': return plus; case ':': return colon;
        default: return blank;
    }
}

} // namespace

Image::Image(int w, int h) : w_(w), h_(h), px_(w * h), depth_(w * h, 1.f) {}

void Image::clear(v3 color) {
    std::fill(px_.begin(), px_.end(), color);
    std::fill(depth_.begin(), depth_.end(), 1.f);
}

void Image::set(int x, int y, v3 color) {
    if (x < 0 || y < 0 || x >= w_ || y >= h_) return;
    px_[y * w_ + x] = color;
}

v3 Image::get(int x, int y) const {
    if (x < 0 || y < 0 || x >= w_ || y >= h_) return {0, 0, 0};
    return px_[y * w_ + x];
}

void Image::setPixelDepth(int x, int y, v3 color, float z) {
    if (x < 0 || y < 0 || x >= w_ || y >= h_) return;
    int idx = y * w_ + x;
    if (z >= depth_[idx]) return;
    depth_[idx] = z;
    px_[idx] = color;
}

void Image::line(v2 a, v2 b, v3 color) {
    int x0 = (int)std::round(a.x), y0 = (int)std::round(a.y);
    int x1 = (int)std::round(b.x), y1 = (int)std::round(b.y);
    int dx = std::abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    int dy = -std::abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    int err = dx + dy;
    while (true) {
        set(x0, y0, color);
        if (x0 == x1 && y0 == y1) break;
        int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

void Image::text(const std::string& s, int x, int y, v3 color, int scale) {
    int cx = x;
    for (char c : s) {
        if (c == ' ') { cx += 6 * scale; continue; }
        const auto& g = glyph(c);
        for (int row = 0; row < 7; ++row) {
            for (int col = 0; col < 5; ++col) {
                if (g[row] & (1 << (4 - col))) {
                    for (int dy = 0; dy < scale; ++dy)
                        for (int dx = 0; dx < scale; ++dx)
                            set(cx + col * scale + dx, y + row * scale + dy, color);
                }
            }
        }
        cx += 6 * scale;
    }
}

void Image::triangle(v2 p0, v2 p1, v2 p2,
                     v3 c0, v3 c1, v3 c2,
                     float z0, float z1, float z2) {
    float area = det2(v2{p1.x - p0.x, p1.y - p0.y},
                      v2{p2.x - p0.x, p2.y - p0.y});
    if (std::abs(area) < 1e-8f) return;
    int minX = std::max(0, (int)std::floor(std::min({p0.x, p1.x, p2.x})));
    int maxX = std::min(w_ - 1, (int)std::ceil(std::max({p0.x, p1.x, p2.x})));
    int minY = std::max(0, (int)std::floor(std::min({p0.y, p1.y, p2.y})));
    int maxY = std::min(h_ - 1, (int)std::ceil(std::max({p0.y, p1.y, p2.y})));
    for (int y = minY; y <= maxY; ++y) {
        for (int x = minX; x <= maxX; ++x) {
            v2 q{(float)x + 0.5f, (float)y + 0.5f};
            float w0 = det2(v2{p1.x - q.x, p1.y - q.y},
                            v2{p2.x - q.x, p2.y - q.y}) / area;
            float w1 = det2(v2{p2.x - q.x, p2.y - q.y},
                            v2{p0.x - q.x, p0.y - q.y}) / area;
            float w2 = 1.f - w0 - w1;
            if (w0 < 0.f || w1 < 0.f || w2 < 0.f) continue;
            float z = w0 * z0 + w1 * z1 + w2 * z2;
            int idx = y * w_ + x;
            if (z >= depth_[idx]) continue;
            depth_[idx] = z;
            px_[idx] = c0 * w0 + c1 * w1 + c2 * w2;
        }
    }
}

bool Image::savePPM(const std::string& path) const {
    std::ofstream f(path, std::ios::binary);
    if (!f) return false;
    f << "P6\n" << w_ << ' ' << h_ << "\n255\n";
    for (v3 c : px_) {
        unsigned char rgb[3] = {
            (unsigned char)(clampf(c.x, 0.f, 1.f) * 255.f),
            (unsigned char)(clampf(c.y, 0.f, 1.f) * 255.f),
            (unsigned char)(clampf(c.z, 0.f, 1.f) * 255.f)};
        f.write((char*)rgb, 3);
    }
    return (bool)f;
}
