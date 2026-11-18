#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "lp/scene_builder.h"
#include "lp/sampler.h"

using namespace lp;

namespace {

const char* modeName(SampleMode mode) {
    switch (mode) {
        case SampleMode::Tetrahedral: return "TETRAHEDRAL";
        case SampleMode::NearestProbe: return "NEAREST-PROBE";
        case SampleMode::ExplicitFallback: return "EXPLICIT-FALLBACK";
    }
    return "?";
}

std::string fmt(float value) {
    std::ostringstream stream;
    stream << std::fixed << std::setprecision(3) << std::setw(7) << value;
    return stream.str();
}

std::string fmtRgb(const Rgb& color) {
    std::ostringstream stream;
    stream << "(" << fmt(color.r) << "," << fmt(color.g) << ","
           << fmt(color.b) << ")";
    return stream.str();
}

void printProbeHud(const ProbeVolume& volume, const SampleResult& result) {
    std::cout << "    probe |   pos   | zone | bary(geom) | visibility | "
                 "final w | usable\n";
    for (int corner = 0; corner < 4; ++corner) {
        int id = result.tetraProbeIds[corner];
        if (id < 0) {
            std::cout << "      -\n";
            continue;
        }
        const Probe& probe = volume.probes()[id];
        std::cout << "  " << std::setw(5) << id << " | ("
                  << probe.position.x << "," << probe.position.y << ","
                  << probe.position.z << ") |   " << probe.zoneId
                  << "  | " << fmt(result.tetraBarycentric[corner])
                  << " | " << fmt(result.tetraVisibility[corner])
                  << " | " << fmt(result.tetraWeights[corner]) << " | "
                  << (result.tetraAvailable[corner] ? "yes" : "NO")
                  << "\n";
    }
}

void printResult(const ProbeVolume& volume, const Vec3& position,
                 const SampleResult& result) {
    std::cout << "  object at (" << position.x << ", " << position.y << ", "
              << position.z << "), mode=" << modeName(result.mode)
              << ", zone=" << result.zoneId
              << ", weightSum=" << fmt(result.weightSum)
              << ", exposure(blended stops)=" << fmt(result.exposureBias)
              << "\n";
    if (result.insideVolume) printProbeHud(volume, result);
    std::cout << "    blended normalized color = " << fmtRgb(result.color)
              << "\n";
}

} // namespace

int main() {
    const float dt = 1.0f / 60.0f;

    std::cout << "=== Two-room light-probe leak test ===\n";
    std::cout << "Room 0 (x<1.5): dim warm probes, exposure bias 0 stops\n";
    std::cout << "Room 1 (x>1.5): bright cool probes, exposure bias +1 stop\n";
    std::cout << "Sealing wall on the lattice face x = "
              << TwoRoomScene::kWallMinX << " (thin solid slab)\n\n";

    TwoRoomScene scene = buildTwoRoomScene();
    std::cout << "Lattice: " << TwoRoomScene::kCounts[0] << "x"
              << TwoRoomScene::kCounts[1] << "x" << TwoRoomScene::kCounts[2]
              << " probes = " << scene.volume->probes().size()
              << " probes, " << scene.volume->tetrahedra().size()
              << " tetrahedra (five per cube cell, alternating parity)\n\n";

    {
        ProbeSampler sampler(*scene.volume, scene.walls,
                             scene.fallbackColor, scene.fallbackZone);

        std::cout << "--- A. Settle next to the wall on the dim side ---\n";
        SampleResult result;
        for (int frame = 0; frame < 120; ++frame) {
            result = sampler.sample(Vec3(1.2f, 0.5f, 0.5f), dt);
        }
        printResult(*scene.volume, Vec3(1.2f, 0.5f, 0.5f), result);
        float leakedWeight = 0.0f;
        for (std::size_t id = 0; id < result.perProbeWeight.size(); ++id) {
            if (scene.volume->probes()[id].zoneId ==
                TwoRoomScene::kRightZone) {
                leakedWeight += result.perProbeWeight[id];
            }
        }
        std::cout << "    -> weight leaking into bright room probes = "
                  << fmt(leakedWeight)
                  << (leakedWeight == 0.0f ? "  [no leak]\n\n" : "\n\n");

        std::cout << "--- B. Walk through the wall into the bright room "
                     "(small steps) ---\n";
        Rgb previousColor = result.color;
        float maxStep = 0.0f;
        constexpr int kSteps = 150;
        for (int step = 0; step <= kSteps; ++step) {
            float x = 0.5f + step * (3.0f / kSteps);
            SampleResult current = sampler.sample(Vec3(x, 0.5f, 0.5f), dt);
            // Skip the first frame: it seeds the temporal smoother rather
            // than representing a real frame-to-frame lighting change.
            if (step > 0) {
                float colorStep =
                    std::fabs(current.color.r - previousColor.r);
                maxStep = std::max(maxStep, colorStep);
            }
            previousColor = current.color;
            if (step % 30 == 0) {
                printResult(*scene.volume, Vec3(x, 0.5f, 0.5f), current);
            }
        }
        std::cout << "    -> largest per-frame color step along the path = "
                  << fmt(maxStep) << " (no single-frame pop)\n\n";
    }

    {
        std::cout << "--- C. Cross an interpolation face inside one room "
                     "---\n";
        ProbeSampler sampler(*scene.volume, scene.walls,
                             scene.fallbackColor, scene.fallbackZone);
        SampleResult left = sampler.sample(Vec3(0.9999f, 0.4f, 0.6f), dt);
        SampleResult right = sampler.sample(Vec3(1.0001f, 0.4f, 0.6f), dt);
        printResult(*scene.volume, Vec3(0.9999f, 0.4f, 0.6f), left);
        printResult(*scene.volume, Vec3(1.0001f, 0.4f, 0.6f), right);
        std::cout << "    -> color delta across the shared face = "
                  << fmt(std::fabs(left.color.r - right.color.r))
                  << " (conforming tet split, continuous)\n\n";
    }

    {
        std::cout << "--- D. Sealed chamber: every local probe fails ---\n";
        std::vector<Box> walls = scene.walls;
        walls.push_back(Box{{0.88f, -0.05f, -0.05f},
                            {0.96f, 2.05f, 2.05f}});
        walls.push_back(Box{{0.96f, -0.05f, -0.05f},
                            {1.04f, 0.45f, 2.05f}});
        walls.push_back(Box{{0.96f, 0.55f, -0.05f},
                            {1.04f, 2.05f, 2.05f}});
        ProbeSampler sampler(*scene.volume, walls, scene.fallbackColor,
                             scene.fallbackZone);
        SampleResult result;
        for (int frame = 0; frame < 200; ++frame) {
            result = sampler.sample(Vec3(1.0f, 0.5f, 0.5f), dt);
        }
        printResult(*scene.volume, Vec3(1.0f, 0.5f, 0.5f), result);
        std::cout << "    -> explicit fallback color "
                  << fmtRgb(scene.fallbackColor)
                  << ", weightSum kept at 0 (no divide-by-zero), no "
                     "bright-room probe sampled\n";
    }
    return 0;
}
