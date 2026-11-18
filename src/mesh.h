#pragma once
#include "mathlib.h"
#include <vector>
#include <string>

struct Vertex {
    v3 pos;
    v3 normal;
    v2 uv;
};

struct Triangle {
    int v[3];
};

// Tangent frame produced by the CPU reference implementation.
// T and N are unit length; B = handedness * cross(N, T), also unit.
struct TangentFrame {
    v3 T{0, 0, 0};
    v3 B{0, 0, 0};
    v3 N{0, 1, 0};
    float handedness = 1.f; // +1 direct UV, -1 mirrored UV
    bool degenerate = false; // zero UV area: declared fallback frame
};

struct Mesh {
    std::vector<Vertex> verts;
    std::vector<Triangle> tris;

    // Per-vertex reference tangent frame (computed once).
    std::vector<TangentFrame> frames;
    // Per-face UV winding: +1 / -1, 0 for zero-area UV faces.
    std::vector<float> faceSign;
    bool faceDegenerate(size_t i) const { return faceSign[i] == 0.f; }

    // Declared fallback used for every degenerate-UV triangle.
    v3 degenerateNormal{0.f, 1.f, 0.f};
    v3 degenerateTangent{1.f, 0.f, 0.f};

    void computeFaceNormals(std::vector<v3>& out) const;
};

// Build the test mesh: one grid with a normal UV island, a mirrored UV
// island, and one triangle whose UV area is zero.
Mesh buildTestMesh(int gridSegments = 4);

// CPU reference tangent generation (area-weighted, Mikkelsen-style).
// Safe against zero-area UV: no NaN is ever produced; degenerate faces
// contribute nothing and their vertices fall back to the declared frame.
void generateTangents(Mesh& mesh);

// Shader-side reconstruction: Gram-Schmidt re-orthogonalization of T
// against the (possibly smoothed) normal, then B from the handedness.
TangentFrame shaderFrame(const TangentFrame& vertexFrame, v3 smoothNormal);

// Tangent-space normal -> world space using a TBN frame.
v3 tangentToWorld(const TangentFrame& frame, v3 tangentNormal);
