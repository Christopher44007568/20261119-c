#pragma once
#include "mesh.h"
#include "normalmap.h"
#include "image.h"
#include <string>

struct Camera {
    float tiltX = 0.6f;   // radians, tilt the plane toward the viewer
    float spinY = 0.15f;
    v3 lightDir{0.4f, 0.8f, 0.45f};
    v3 viewDir{0.f, 0.f, 1.f};
    float pixelsPerUnit = 110.f;
};

class Renderer {
public:
    Renderer(int width, int height);

    // Full normal-mapped Blinn-Phong rendering. uvRotation rotates the
    // normal-map lookup; degenerate-UV faces use the declared normal.
    void renderLighting(const Mesh& mesh, const NormalMap& map,
                        float uvRotation, const std::string& path,
                        v3 baseColor = {0.55f, 0.62f, 0.85f});

    // Debug view: chirality tint plus T (red) / B (green) / N (blue) axes.
    void renderTbnViz(const Mesh& mesh, const std::string& path);

    v2 project(v3 world) const;
    float depthOf(v3 world) const;

private:
    int w_, h_;
    Camera cam_;

    v3 rotateView(v3 p) const;
};
