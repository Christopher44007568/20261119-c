#pragma once

#include <vector>

#include <memory>

#include "lp/probe_volume.h"
#include "lp/sampler.h"
#include "lp/types.h"

namespace lp {

struct TwoRoomScene {
    static constexpr int kLeftZone = 0;
    static constexpr int kRightZone = 1;

    // Probe lattice spanning both rooms. The wall plane x = 1.5 coincides
    // with a cell boundary; within each room every tet is single-zone, and
    // the only mixed-zone tets live in cells touching the wall. Those are
    // handled at sample time by hard zone filtering and raycast occlusion,
    // never by geometric blending across the wall.
    static constexpr std::array<int, 3> kCounts{{4, 3, 3}};
    static constexpr Vec3 kOrigin{0.0f, 0.0f, 0.0f};
    static constexpr Vec3 kSpacing{1.0f, 1.0f, 1.0f};

    // The wall coincides with the lattice face between probe columns x=1 and
    // x=2 (cell boundary x = 1.5). No tetrahedron crosses this plane, so a
    // moving object can never blend a left-room probe with a right-room one:
    // cross-wall sampling always resolves through the same-zone fallback.
    static constexpr float kWallMinX = 1.5f;
    static constexpr float kWallMaxX = 1.5f;

    std::unique_ptr<ProbeVolume> volume;
    std::vector<Box> walls;
    Rgb fallbackColor{0.05f, 0.05f, 0.06f};
    int fallbackZone = -1;

    // Room A (left) is a dim, warm room; room B (right) is a bright cool
    // room. The right room is also baked with a +1 stop exposure bias to
    // exercise exposure normalization.
    static Rgb leftRoomColor(const Vec3& position) {
        float warmth = 0.7f + 0.3f * position.y / kSpacing.y;
        return {0.25f * warmth, 0.18f * warmth, 0.10f * warmth};
    }
    static Rgb rightRoomColor(const Vec3& position) {
        float level = 0.85f + 0.15f * position.z / (2.0f * kSpacing.z);
        return {0.70f * level, 0.85f * level, 1.10f * level};
    }
};

// Builds the lattice, assigns zones/colors/exposure and returns the solid
// wall boxes. Probe columns x in {0,1} belong to the left room and {2,3} to
// the right room, so no tetrahedron crosses the wall with mixed zones.
inline TwoRoomScene buildTwoRoomScene() {
    TwoRoomScene scene;
    scene.volume = std::make_unique<ProbeVolume>(
        TwoRoomScene::kOrigin, TwoRoomScene::kSpacing, TwoRoomScene::kCounts);

    for (Probe& probe : scene.volume->probes()) {
        int columnX = probe.id / (TwoRoomScene::kCounts[1] *
                                  TwoRoomScene::kCounts[2]);
        bool rightRoom = columnX >= 2;
        probe.zoneId = rightRoom ? TwoRoomScene::kRightZone
                                 : TwoRoomScene::kLeftZone;
        probe.color = rightRoom
                          ? TwoRoomScene::rightRoomColor(probe.position)
                          : TwoRoomScene::leftRoomColor(probe.position);
        probe.exposureBias = rightRoom ? 1.0f : 0.0f;
        probe.visibility = 1.0f;
    }

    // Full-height, full-depth sealing wall on the shared lattice face. The
    // tiny half-thickness keeps the slab finite while staying clear of every
    // probe position (probes sit exactly one full spacing away).
    constexpr float kHalfThickness = 0.01f;
    scene.walls.push_back(Box{
        {TwoRoomScene::kWallMinX - kHalfThickness, -0.05f, -0.05f},
        {TwoRoomScene::kWallMaxX + kHalfThickness, 2.05f, 2.05f}});
    return scene;
}

} // namespace lp
