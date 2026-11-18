#include "renderer.h"
#include <cmath>

namespace {
v3 rotX(v3 p, float a) {
    float c = std::cos(a), s = std::sin(a);
    return {p.x, c * p.y - s * p.z, s * p.y + c * p.z};
}
v3 rotY(v3 p, float a) {
    float c = std::cos(a), s = std::sin(a);
    return {c * p.x + s * p.z, p.y, -s * p.x + c * p.z};
}
} // namespace

Renderer::Renderer(int width, int height) : w_(width), h_(height) {}

v3 Renderer::rotateView(v3 p) const {
    return rotY(rotX(p, cam_.tiltX), cam_.spinY);
}

v2 Renderer::project(v3 world) const {
    v3 q = rotateView(world);
    return {(float)w_ * 0.5f + q.x * cam_.pixelsPerUnit,
            (float)h_ * 0.60f - q.y * cam_.pixelsPerUnit};
}

float Renderer::depthOf(v3 world) const {
    // Map view Z (roughly [-4, 2]) into [0,1].
    return clampf((rotateView(world).z + 4.f) / 6.f, 0.f, 1.f);
}

void Renderer::renderLighting(const Mesh& mesh, const NormalMap& map,
                              float uvRotation, const std::string& path,
                              v3 baseColor) {
    Image img(w_, h_);
    img.clear({0.08f, 0.09f, 0.12f});

    for (size_t f = 0; f < mesh.tris.size(); ++f) {
        const Triangle& tr = mesh.tris[f];
        bool deg = mesh.faceDegenerate(f);

        v2 sp[3];
        v3 vn[3]; v2 uvs[3]; float z[3];
        for (int k = 0; k < 3; ++k) {
            const Vertex& vx = mesh.verts[tr.v[k]];
            sp[k] = project(vx.pos);
            z[k] = depthOf(vx.pos);
            vn[k] = vx.normal;
            uvs[k] = vx.uv;
        }

        // Per-fragment: interpolate world position, UV and vertex normal,
        // then reconstruct and re-orthogonalize the TBN at every pixel.
        float area = det2(v2{sp[1].x - sp[0].x, sp[1].y - sp[0].y},
                          v2{sp[2].x - sp[0].x, sp[2].y - sp[0].y});
        if (std::abs(area) < 1e-8f) continue;
        int minX = std::max(0, (int)std::floor(std::min({sp[0].x, sp[1].x, sp[2].x})));
        int maxX = std::min(w_ - 1, (int)std::ceil(std::max({sp[0].x, sp[1].x, sp[2].x})));
        int minY = std::max(0, (int)std::floor(std::min({sp[0].y, sp[1].y, sp[2].y})));
        int maxY = std::min(h_ - 1, (int)std::ceil(std::max({sp[0].y, sp[1].y, sp[2].y})));

        for (int y = minY; y <= maxY; ++y) {
            for (int x = minX; x <= maxX; ++x) {
                v2 q{(float)x + 0.5f, (float)y + 0.5f};
                float b0 = det2(v2{sp[1].x - q.x, sp[1].y - q.y},
                                v2{sp[2].x - q.x, sp[2].y - q.y}) / area;
                float b1 = det2(v2{sp[2].x - q.x, sp[2].y - q.y},
                                v2{sp[0].x - q.x, sp[0].y - q.y}) / area;
                float b2 = 1.f - b0 - b1;
                if (b0 < 0.f || b1 < 0.f || b2 < 0.f) continue;
                float zc = b0 * z[0] + b1 * z[1] + b2 * z[2];
                v3 nrm = normalize(vn[0] * b0 + vn[1] * b1 + vn[2] * b2);
                v3 worldN;
                if (deg) {
                    worldN = normalize(mesh.degenerateNormal);
                } else {
                    v2 uv = uvs[0] * b0 + uvs[1] * b1 + uvs[2] * b2;
                    // Interpolate vertex tangents, then re-orthogonalize
                    // per fragment against the interpolated normal.
                    TangentFrame avg = mesh.frames[tr.v[0]];
                    v3 tSum = mesh.frames[tr.v[0]].T * b0
                            + mesh.frames[tr.v[1]].T * b1
                            + mesh.frames[tr.v[2]].T * b2;
                    avg.T = tSum;
                    TangentFrame ff = shaderFrame(avg, nrm);
                    v3 tn = map.sample(uv, uvRotation);
                    worldN = tangentToWorld(ff, tn);
                }
                v3 col = blinnPhong(worldN, cam_.lightDir, cam_.viewDir,
                                    baseColor, 80.f);
                img.setPixelDepth(x, y, col, zc);
            }
        }
    }
    img.savePPM(path);
}

void Renderer::renderTbnViz(const Mesh& mesh, const std::string& path) {
    Image img(w_, h_);
    img.clear({0.10f, 0.11f, 0.14f});

    // Fill triangles with chirality color:
    // green = direct UV (+1), red = mirrored (-1), gray = degenerate.
    for (size_t f = 0; f < mesh.tris.size(); ++f) {
        const Triangle& tr = mesh.tris[f];
        v3 tint;
        if (mesh.faceDegenerate(f)) {
            tint = {0.45f, 0.45f, 0.5f};
        } else if (mesh.faceSign[f] > 0.f) {
            tint = {0.18f, 0.55f, 0.25f};
        } else {
            tint = {0.75f, 0.25f, 0.2f};
        }
        v2 sp[3]; float z[3];
        for (int k = 0; k < 3; ++k) {
            const Vertex& vx = mesh.verts[tr.v[k]];
            sp[k] = project(vx.pos);
            z[k] = depthOf(vx.pos);
        }
        img.triangle(sp[0], sp[1], sp[2], tint, tint, tint,
                     z[0], z[1], z[2]);
    }

    // Draw one TBN tripod per sampled vertex. T=red, B=green, N=blue.
    // Axes are drawn at their true length; the handedness shows up as the
    // B direction flipping on the mirrored (red) island.
    float axisLen = 0.22f;
    for (size_t i = 0; i < mesh.verts.size(); i += 3) {
        const TangentFrame& fr = mesh.frames[i];
        v3 origin = mesh.verts[i].pos;
        v3 tEnd = origin + fr.T * axisLen;
        v3 bEnd = origin + fr.B * axisLen;
        v3 nEnd = origin + fr.N * axisLen;
        v2 o = project(origin);
        img.line(o, project(tEnd), {1.f, 0.25f, 0.2f});
        img.line(o, project(bEnd), {0.25f, 1.f, 0.35f});
        img.line(o, project(nEnd), {0.35f, 0.5f, 1.f});
    }

    // Legend.
    img.text("T", 12, 12, {1.f, 0.25f, 0.2f}, 2);
    img.text("RED", 30, 12, {0.9f, 0.9f, 0.9f}, 2);
    img.text("B", 96, 12, {0.25f, 1.f, 0.35f}, 2);
    img.text("GREEN", 114, 12, {0.9f, 0.9f, 0.9f}, 2);
    img.text("N", 210, 12, {0.35f, 0.5f, 1.f}, 2);
    img.text("BLUE", 228, 12, {0.9f, 0.9f, 0.9f}, 2);
    img.text("GREEN ISLAND DIRECT UV SIGN +1", 12, 36, {0.35f, 1.f, 0.45f}, 1);
    img.text("RED ISLAND MIRRORED UV SIGN -1", 12, 48, {1.f, 0.5f, 0.45f}, 1);
    img.text("GRAY TRIANGLE ZERO UV AREA DECLARED NORMAL", 12, 60, {0.8f, 0.8f, 0.85f}, 1);
    img.savePPM(path);
}
