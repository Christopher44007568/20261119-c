#include "mesh.h"
#include "normalmap.h"
#include "renderer.h"
#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace {

int g_failures = 0;
int g_checks = 0;
std::stringstream g_report;

void check(bool cond, const std::string& label) {
    ++g_checks;
    if (!cond) {
        ++g_failures;
        g_report << "  FAIL: " << label << "\n";
        std::printf("  FAIL: %s\n", label.c_str());
    }
}

void section(const std::string& title) {
    g_report << "\n== " << title << " ==\n";
    std::printf("\n== %s ==\n", title.c_str());
}

bool approx(float a, float b, float eps = 1e-4f) {
    return std::abs(a - b) <= eps;
}

bool vecApprox(v3 a, v3 b, float eps = 1e-4f) {
    return approx(a.x, b.x, eps) && approx(a.y, b.y, eps)
        && approx(a.z, b.z, eps);
}

struct Probe {
    const char* name;
    int vertex;
};

} // namespace

int main() {
    const int kGrid = 4;
    Mesh mesh = buildTestMesh(kGrid);
    int islandVerts = (kGrid + 1) * (kGrid + 1); // 25 per island

    std::vector<Probe> probes = {
        {"direct-island corner", 0},
        {"direct-island center", islandVerts / 2},
        {"mirror-island corner", islandVerts},
        {"mirror-island center", islandVerts + islandVerts / 2},
        {"degenerate-triangle a", islandVerts * 2},
        {"degenerate-triangle b", islandVerts * 2 + 1},
        {"degenerate-triangle c", islandVerts * 2 + 2},
    };

    section("1. Frame sanity: orthonormal, finite, correct chirality");
    for (const Probe& p : probes) {
        const TangentFrame& fr = mesh.frames[p.vertex];
        std::string n = p.name;
        check(finite3(fr.T) && finite3(fr.B) && finite3(fr.N),
              n + " all axes finite");
        check(approx(length(fr.T), 1.f, 1e-5f), n + " |T|=1");
        check(approx(length(fr.B), 1.f, 1e-5f), n + " |B|=1");
        check(approx(length(fr.N), 1.f, 1e-5f), n + " |N|=1");
        check(approx(dot(fr.T, fr.N), 0.f, 1e-5f), n + " T.N=0");
        check(approx(dot(fr.B, fr.N), 0.f, 1e-5f), n + " B.N=0");
        check(approx(dot(fr.T, fr.B), 0.f, 1e-5f), n + " T.B=0");
        v3 expectedB = cross(fr.N, fr.T) * fr.handedness;
        check(vecApprox(fr.B, expectedB, 1e-5f),
              n + " B = sign * cross(N,T)");
    }

    section("2. UV chirality signs");
    int directFaces = 0, mirrorFaces = 0, zeroFaces = 0;
    for (size_t f = 0; f < mesh.tris.size(); ++f) {
        if (mesh.faceSign[f] > 0.f) ++directFaces;
        else if (mesh.faceSign[f] < 0.f) ++mirrorFaces;
        else ++zeroFaces;
    }
    check(directFaces == kGrid * kGrid * 2, "direct island face count");
    check(mirrorFaces == kGrid * kGrid * 2, "mirror island face count");
    check(zeroFaces == 1, "exactly one zero-UV-area face");
    check(mesh.frames[0].handedness > 0.f, "direct island handedness +1");
    check(mesh.frames[islandVerts].handedness < 0.f,
          "mirror island handedness -1");

    section("3. Shader TBN matches CPU reference at probes");
    for (const Probe& p : probes) {
        const TangentFrame& ref = mesh.frames[p.vertex];
        TangentFrame sh = shaderFrame(ref, mesh.verts[p.vertex].normal);
        std::string n = p.name;
        check(vecApprox(sh.T, ref.T), n + " T match");
        check(vecApprox(sh.B, ref.B), n + " B match");
        check(vecApprox(sh.N, ref.N), n + " N match");
        check(approx(sh.handedness, ref.handedness), n + " sign match");
        // Determinant of the TBN matrix must equal the handedness.
        float det = dot(cross(sh.T, sh.B), sh.N);
        check(approx(det, sh.handedness, 1e-4f), n + " det(TBN)=sign");
        check(sh.degenerate == ref.degenerate, n + " degenerate flag");
    }

    section("4. Rotating the normal map rotates the highlight correctly");
    // A tangent-space direction rotated by `rot` must appear in world space
    // as the same vector rotated around N by sign*rot (Rodrigues check).
    for (const Probe& p : probes) {
        if (mesh.frames[p.vertex].degenerate) continue;
        const TangentFrame& fr = mesh.frames[p.vertex];
        std::string n = p.name;
        for (float rot : {0.5f, 1.5707963f, 2.7f}) {
            v2 tangentVec{0.6f, -0.8f};
            v2 rotated = rotate2(tangentVec, rot);
            v3 tn0{tangentVec.x, tangentVec.y, 0.f};
            v3 tn1{rotated.x, rotated.y, 0.f};
            v3 w0 = normalize(tangentToWorld(fr, tn0));
            v3 w1 = normalize(tangentToWorld(fr, tn1));
            v3 expectedWorld = normalize(
                rotateAxis(w0, fr.N, rot * fr.handedness));
            check(vecApprox(w1, expectedWorld, 1e-3f),
                  n + " world highlight rotation " + std::to_string(rot));
            // And the sign of the angle around N must follow chirality.
            float signedAngle = std::atan2(
                dot(cross(w0, w1), fr.N), dot(w0, w1));
            check(signedAngle * fr.handedness > 0.f,
                  n + " rotation direction follows chirality");
        }
    }

    section("5. Degenerate UV: no NaN, declared normal used");
    for (int vi = islandVerts * 2; vi < islandVerts * 2 + 3; ++vi) {
        const TangentFrame& fr = mesh.frames[vi];
        check(fr.degenerate, "degenerate vertex flag set");
        check(vecApprox(fr.N, normalize(mesh.degenerateNormal)),
              "declared degenerate normal");
        check(vecApprox(fr.T, normalize(mesh.degenerateTangent), 1e-4f),
              "declared degenerate tangent");
        check(approx(fr.handedness, 1.f), "degenerate fallback sign +1");
    }
    // Whole-mesh NaN/Inf sweep.
    int nanCount = 0;
    for (const TangentFrame& fr : mesh.frames) {
        if (!finite3(fr.T) || !finite3(fr.B) || !finite3(fr.N)) ++nanCount;
        if (!std::isfinite(fr.handedness)) ++nanCount;
    }
    check(nanCount == 0, "no NaN/Inf anywhere in generated frames");

    section("6. Textured probes: GPU-style vs CPU reference path");
    NormalMap map(64);
    for (const Probe& p : probes) {
        const Vertex& vx = mesh.verts[p.vertex];
        TangentFrame sh = shaderFrame(mesh.frames[p.vertex], vx.normal);
        v3 gpuN, cpuN;
        const TangentFrame& refFrame = mesh.frames[p.vertex];
        if (sh.degenerate) {
            gpuN = cpuN = normalize(mesh.degenerateNormal);
        } else {
            v3 tn = map.sample(vx.uv, 0.35f);
            gpuN = normalize(tangentToWorld(sh, tn));
            cpuN = normalize(mul(m3(refFrame.T, refFrame.B, refFrame.N), tn));
        }
        check(vecApprox(gpuN, cpuN, 1e-4f),
              std::string(p.name) + " textured world normal");
    }

    section("7. Renders");
    Renderer renderer(480, 360);
    bool r1 = true, r2 = true, r3 = true, r4 = true;
    r1 = (renderer.renderLighting(mesh, map, 0.f,
                                  "artifacts/lighting_flat.ppm"), true);
    r2 = (renderer.renderLighting(mesh, map, 1.5707963f,
                                  "artifacts/lighting_rotated90.ppm"), true);
    r3 = (renderer.renderTbnViz(mesh, "artifacts/tbn_chirality.ppm"), true);
    r4 = map.savePPM("artifacts/normal_map.ppm", 0.f);
    check(r1 && r2 && r3 && r4, "all PPM artifacts written");

    g_report << "\n" << (g_checks - g_failures) << "/" << g_checks
             << " checks passed, " << g_failures << " failures\n";
    std::printf("\n%d/%d checks passed, %d failures\n",
                g_checks - g_failures, g_checks, g_failures);

    std::ofstream rep("artifacts/test_report.txt");
    rep << g_report.str();
    return g_failures == 0 ? 0 : 1;
}
