#include "mesh.h"
#include <cmath>

void Mesh::computeFaceNormals(std::vector<v3>& out) const {
    out.resize(tris.size());
    for (size_t i = 0; i < tris.size(); ++i) {
        const v3& p0 = verts[tris[i].v[0]].pos;
        const v3& p1 = verts[tris[i].v[1]].pos;
        const v3& p2 = verts[tris[i].v[2]].pos;
        out[i] = normalize(cross(p1 - p0, p2 - p0));
    }
}

namespace {

struct PatchBuilder {
    Mesh& mesh;
    int base;

    explicit PatchBuilder(Mesh& m) : mesh(m), base((int)m.verts.size()) {}

    int add(v3 pos, v3 n, v2 uv) {
        mesh.verts.push_back({pos, n, uv});
        return (int)mesh.verts.size() - 1;
    }

    void tri(int a, int b, int c) {
        mesh.tris.push_back({{a, b, c}});
    }

    // Grid patch over [x0,x1] x [z0,z1] at height y.
    // mirrorU flips the U axis so this UV island has negative chirality.
    void grid(int seg, float x0, float x1, float z0, float z1,
              float y, bool mirrorU) {
        int idx[16][16];
        for (int j = 0; j <= seg; ++j) {
            for (int i = 0; i <= seg; ++i) {
                float fx = (float)i / (float)seg;
                float fz = (float)j / (float)seg;
                v3 pos{x0 + (x1 - x0) * fx, y, z0 + (z1 - z0) * fz};
                float u = mirrorU ? 1.f - fx : fx;
                // Flipped V so the direct island has UV determinant > 0
                // (handedness +1); the mirrored island then gets -1.
                v2 uv{u, 1.f - fz};
                idx[j][i] = add(pos, v3{0, 1, 0}, uv);
            }
        }
        for (int j = 0; j < seg; ++j) {
            for (int i = 0; i < seg; ++i) {
                int a = idx[j][i];
                int b = idx[j + 1][i];
                int c = idx[j + 1][i + 1];
                int d = idx[j][i + 1];
                // Winding chosen so the geometric face normal is +Y.
                tri(a, b, c);
                tri(a, c, d);
            }
        }
    }
};

constexpr float kDetEps = 1e-10f;

v3 safeOrthogonalize(v3 t, v3 n) {
    v3 r = t - n * dot(n, t);
    if (length2(r) > 1e-20f) return normalize(r);
    // T parallel to N (or zero): rebuild from an arbitrary vector.
    v3 helper = std::abs(n.y) < 0.9f ? v3{0, 1, 0} : v3{1, 0, 0};
    return normalize(helper - n * dot(n, helper));
}

} // namespace

Mesh buildTestMesh(int gridSegments) {
    Mesh mesh;
    PatchBuilder pb(mesh);

    // Island 1: direct UVs, determinant > 0, handedness +1.
    pb.grid(gridSegments, -2.f, 0.f, -1.f, 1.f, 0.f, false);
    // Island 2: mirrored U, determinant < 0, handedness -1.
    pb.grid(gridSegments, 0.f, 2.f, -1.f, 1.f, 0.f, true);

    // Triangle with zero UV area: all three UVs are identical.
    // It sits just below the plane so it is visually distinct.
    v3 dn = mesh.degenerateNormal;
    int d0 = pb.add(v3{-1.f, -1.2f, -1.f}, dn, v2{0.5f, 0.5f});
    int d1 = pb.add(v3{1.f, -1.2f, -1.f}, dn, v2{0.5f, 0.5f});
    int d2 = pb.add(v3{0.f, -1.2f, 1.f}, dn, v2{0.5f, 0.5f});
    pb.tri(d0, d1, d2);

    generateTangents(mesh);
    return mesh;
}

void generateTangents(Mesh& mesh) {
    int nv = (int)mesh.verts.size();
    std::vector<v3> tanSum(nv, v3{0, 0, 0});
    std::vector<v3> bitSum(nv, v3{0, 0, 0});
    mesh.faceSign.assign(mesh.tris.size(), 0.f);

    for (size_t f = 0; f < mesh.tris.size(); ++f) {
        const Triangle& tr = mesh.tris[f];
        const Vertex& p0 = mesh.verts[tr.v[0]];
        const Vertex& p1 = mesh.verts[tr.v[1]];
        const Vertex& p2 = mesh.verts[tr.v[2]];

        v3 e1 = p1.pos - p0.pos;
        v3 e2 = p2.pos - p0.pos;
        v2 d1 = p1.uv - p0.uv;
        v2 d2 = p2.uv - p0.uv;

        float det = det2(d1, d2);
        if (!(std::abs(det) > kDetEps)) {
            // Zero UV area: skip. No division -> no NaN, no Inf.
            mesh.faceSign[f] = 0.f;
            continue;
        }
        mesh.faceSign[f] = det > 0.f ? 1.f : -1.f;

        float inv = 1.f / det;
        v3 T = (e1 * d2.y - e2 * d1.y) * inv;
        v3 B = (e2 * d1.x - e1 * d2.x) * inv;

        // Weight by geometric triangle area (Mikkelsen-style smoothing).
        float area = 0.5f * length(cross(e1, e2));
        for (int k = 0; k < 3; ++k) {
            tanSum[tr.v[k]] += T * area;
            bitSum[tr.v[k]] += B * area;
        }
    }

    mesh.frames.resize(nv);
    for (int i = 0; i < nv; ++i) {
        TangentFrame& fr = mesh.frames[i];
        fr.N = normalize(mesh.verts[i].normal);

        if (length2(tanSum[i]) > 1e-20f) {
            // Gram-Schmidt orthogonalization against the vertex normal.
            fr.T = safeOrthogonalize(tanSum[i], fr.N);
            v3 bDir = safeOrthogonalize(bitSum[i], fr.N);
            fr.handedness = dot(cross(fr.N, fr.T), bDir) >= 0.f ? 1.f : -1.f;
            fr.degenerate = false;
        } else {
            // Vertex only touched by degenerate-UV faces: use the
            // explicitly declared fallback, never a normalized zero vector.
            fr.degenerate = true;
            fr.N = normalize(mesh.degenerateNormal);
            fr.T = safeOrthogonalize(mesh.degenerateTangent, fr.N);
            fr.handedness = 1.f;
        }
        fr.B = cross(fr.N, fr.T) * fr.handedness;
    }
}

TangentFrame shaderFrame(const TangentFrame& vf, v3 smoothNormal) {
    TangentFrame out;
    out.N = normalize(smoothNormal);
    out.handedness = vf.handedness;
    out.degenerate = vf.degenerate;
    // Per-fragment Gram-Schmidt, exactly as in the GLSL snippet.
    out.T = safeOrthogonalize(vf.T, out.N);
    out.B = cross(out.N, out.T) * out.handedness;
    return out;
}

v3 tangentToWorld(const TangentFrame& frame, v3 tangentNormal) {
    v3 world = frame.T * tangentNormal.x
             + frame.B * tangentNormal.y
             + frame.N * tangentNormal.z;
    return normalize(world);
}
