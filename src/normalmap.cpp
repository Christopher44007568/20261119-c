#include "normalmap.h"
#include "image.h"
#include <cmath>

namespace {

float heightFn(float u, float v) {
    // Round bump centered at (0.5, 0.5).
    float du = (u - 0.5f) * 2.f;
    float dv = (v - 0.5f) * 2.f;
    float bump = std::exp(-(du * du + dv * dv) * 2.2f);
    // Horizontal ridge: slopes point mostly along the V (tangent Y) axis.
    float ridge = 0.8f * std::exp(-dv * dv * 8.f) * (0.6f + 0.4f * du);
    return 2.5f * bump + ridge;
}

v2 wrap(v2 p) {
    p.x = p.x - std::floor(p.x);
    p.y = p.y - std::floor(p.y);
    return p;
}

} // namespace

NormalMap::NormalMap(int size) : size_(size), texels_(size * size) {
    const float eps = 1.f / (float)size;
    for (int y = 0; y < size; ++y) {
        for (int x = 0; x < size; ++x) {
            float u = ((float)x + 0.5f) / (float)size;
            float v = ((float)y + 0.5f) / (float)size;
            float hL = heightFn(u - eps, v);
            float hR = heightFn(u + eps, v);
            float hD = heightFn(u, v - eps);
            float hU = heightFn(u, v + eps);
            v3 n{(hL - hR) * 2.2f, (hD - hU) * 2.2f, 1.f};
            texels_[y * size + x] = normalize(n);
        }
    }
}

v3 NormalMap::sampleTexel(int x, int y) const {
    x = (x + size_) % size_;
    y = (y + size_) % size_;
    return texels_[y * size_ + x];
}

v3 NormalMap::sample(v2 uv, float uvRotation) const {
    if (uvRotation != 0.f) {
        v2 centered{uv.x - 0.5f, uv.y - 0.5f};
        centered = rotate2(centered, -uvRotation);
        uv = v2{centered.x + 0.5f, centered.y + 0.5f};
    }
    uv = wrap(uv);
    float fx = uv.x * (float)size_ - 0.5f;
    float fy = uv.y * (float)size_ - 0.5f;
    int x0 = (int)std::floor(fx);
    int y0 = (int)std::floor(fy);
    float tx = fx - (float)x0, ty = fy - (float)y0;
    v3 a = sampleTexel(x0, y0);
    v3 b = sampleTexel(x0 + 1, y0);
    v3 c = sampleTexel(x0, y0 + 1);
    v3 d = sampleTexel(x0 + 1, y0 + 1);
    v3 top = lerp(a, b, tx);
    v3 bot = lerp(c, d, tx);
    return normalize(lerp(top, bot, ty));
}

bool NormalMap::savePPM(const std::string& path, float uvRotation) const {
    Image img(size_, size_);
    for (int y = 0; y < size_; ++y) {
        for (int x = 0; x < size_; ++x) {
            v2 uv{((float)x + 0.5f) / (float)size_,
                  ((float)y + 0.5f) / (float)size_};
            v3 n = sample(uv, uvRotation);
            v3 rgb{(n.x * 0.5f + 0.5f),
                   (n.y * 0.5f + 0.5f),
                   (n.z * 0.5f + 0.5f)};
            img.set(x, y, rgb);
        }
    }
    return img.savePPM(path);
}

v3 blinnPhong(v3 worldNormal, v3 lightDir, v3 viewDir,
              v3 baseColor, float shininess) {
    v3 N = normalize(worldNormal);
    v3 L = normalize(lightDir);
    v3 V = normalize(viewDir);
    float diff = std::max(0.f, dot(N, L));
    v3 H = normalize(L + V);
    float spec = std::pow(std::max(0.f, dot(N, H)), shininess);
    v3 ambient = baseColor * 0.10f;
    return ambient + baseColor * (diff * 0.70f) + v3{1, 1, 1} * (spec * 1.2f);
}
