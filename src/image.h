#pragma once
#include "mathlib.h"
#include <string>
#include <vector>

// Row-major RGB image, origin top-left, channels in [0,1].
class Image {
public:
    Image(int w, int h);

    int width() const { return w_; }
    int height() const { return h_; }

    void clear(v3 color);
    void set(int x, int y, v3 color);
    // Write only if z is nearer than the stored depth; updates depth.
    void setPixelDepth(int x, int y, v3 color, float z);
    v3 get(int x, int y) const;

    // Screen-space lines with a small depth buffer (z in [0,1]).
    void line(v2 a, v2 b, v3 color);
    // Minimal 5x7 bitmap font (A-Z, 0-9, '-', '+', ':').
    void text(const std::string& s, int x, int y, v3 color, int scale = 1);

    // Filled triangle with per-vertex interpolated color and depth.
    // Points are in screen pixels; z smaller = nearer.
    void triangle(v2 p0, v2 p1, v2 p2,
                  v3 c0, v3 c1, v3 c2,
                  float z0, float z1, float z2);

    bool savePPM(const std::string& path) const;

private:
    int w_, h_;
    std::vector<v3> px_;
    std::vector<float> depth_;
};
