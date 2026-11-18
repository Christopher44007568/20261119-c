#pragma once
#include "mathlib.h"
#include <string>
#include <vector>

// Procedural tangent-space normal map: a rounded bump plus a linear ridge,
// so the highlight has a clear, testable direction.
class NormalMap {
public:
    explicit NormalMap(int size = 64);

    int size() const { return size_; }

    // Sample in UV space. uvRotation rotates the sample coordinate around
    // the map center (radians), matching a rotated normal map in shader.
    v3 sample(v2 uv, float uvRotation = 0.f) const;

    // Save an RGB visualization (normal components remapped to [0,1]).
    bool savePPM(const std::string& path, float uvRotation = 0.f) const;

private:
    int size_;
    std::vector<v3> texels_;

    v3 sampleTexel(int x, int y) const;
};

// Blinn-Phong lighting of a world-space surface normal.
v3 blinnPhong(v3 worldNormal, v3 lightDir, v3 viewDir,
              v3 baseColor, float shininess);
