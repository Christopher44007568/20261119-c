#include "lp/scene_builder.h"
#include "lp/sampler.h"

#include <cmath>
#include <random>
#include <set>
#include <stdexcept>
#include <vector>

#include "test_framework.h"

using namespace lp;

namespace {

constexpr float kEps = 1e-4f;

ProbeVolume makeSimpleVolume() {
    return ProbeVolume(Vec3(0, 0, 0), Vec3(1, 1, 1), {{2, 2, 2}});
}

void assignUniform(ProbeVolume& volume, Rgb color) {
    for (Probe& probe : volume.probes()) {
        probe.color = color;
        probe.zoneId = 0;
        probe.exposureBias = 0.0f;
        probe.visibility = 1.0f;
    }
}

} // namespace

LP_TEST(barycentric_weights_sum_to_one_inside_a_tet) {
    ProbeVolume volume = makeSimpleVolume();
    assignUniform(volume, Rgb(1, 1, 1));
    const Tetrahedron* tet = nullptr;
    std::array<float, 4> weights{};
    LP_CHECK(volume.locate(Vec3(0.3f, 0.2f, 0.7f), tet, weights));
    LP_CHECK(tet != nullptr);
    float sum = 0.0f;
    for (float weight : weights) {
        LP_CHECK(weight >= -kEps);
        sum += weight;
    }
    LP_CHECK_NEAR(sum, 1.0f);
}

LP_TEST(barycentric_weights_reproduce_vertex_and_centroid) {
    ProbeVolume volume = makeSimpleVolume();
    assignUniform(volume, Rgb(1, 1, 1));

    const Tetrahedron* tet = nullptr;
    std::array<float, 4> weights{};
    LP_CHECK(volume.locate(Vec3(0, 0, 0), tet, weights));
    int ones = 0;
    for (float weight : weights) {
        LP_CHECK(lp_test::nearlyEqual(weight, 0.0f) ||
                 lp_test::nearlyEqual(weight, 1.0f));
        if (lp_test::nearlyEqual(weight, 1.0f)) ++ones;
    }
    LP_CHECK(ones == 1);

    // The cube center is the centroid of whichever tet contains it, so all
    // four barycentric weights must be equal; verify equality rather than a
    // hard-coded value (the located tet can be any of the six).
    LP_CHECK(volume.locate(Vec3(0.5f, 0.5f, 0.5f), tet, weights));
    for (int corner = 1; corner < 4; ++corner) {
        LP_CHECK(lp_test::nearlyEqual(weights[corner], weights[0], 1e-5f));
    }
    LP_CHECK_NEAR(weights[0] + weights[1] + weights[2] + weights[3], 1.0f);
}

LP_TEST(locate_rejects_points_outside_the_lattice) {
    ProbeVolume volume = makeSimpleVolume();
    assignUniform(volume, Rgb(1, 1, 1));
    const Tetrahedron* tet = nullptr;
    std::array<float, 4> weights{};
    LP_CHECK(!volume.locate(Vec3(-0.1f, 0.5f, 0.5f), tet, weights));
    LP_CHECK(!volume.locate(Vec3(1.1f, 0.5f, 0.5f), tet, weights));
    LP_CHECK(tet == nullptr);
}

LP_TEST(every_cube_cell_is_partitioned_into_five_nondegenerate_tets) {
    ProbeVolume volume(Vec3(0, 0, 0), Vec3(1, 1, 1), {{3, 3, 3}});
    assignUniform(volume, Rgb(1, 1, 1));
    int cells = (3 - 1) * (3 - 1) * (3 - 1);
    LP_CHECK(static_cast<int>(volume.tetrahedra().size()) == cells * 5);

    // Monte-Carlo coverage: every random point in every cell must be located
    // in exactly one tetrahedron, and the located tet must belong to that
    // cell (no gaps or overlaps).
    std::mt19937 rng(1234);
    std::uniform_real_distribution<float> jitter(0.05f, 0.95f);
    for (int cx = 0; cx < 2; ++cx) {
        for (int cy = 0; cy < 2; ++cy) {
            for (int cz = 0; cz < 2; ++cz) {
                for (int sample = 0; sample < 50; ++sample) {
                    Vec3 point(cx + jitter(rng), cy + jitter(rng),
                               cz + jitter(rng));
                    const Tetrahedron* tet = nullptr;
                    std::array<float, 4> weights{};
                    LP_CHECK(volume.locate(point, tet, weights));
                    LP_CHECK(tet->cellX == cx && tet->cellY == cy &&
                             tet->cellZ == cz);
                    float sum = 0.0f;
                    for (float weight : weights) sum += weight;
                    LP_CHECK_NEAR(sum, 1.0f);
                }
            }
        }
    }
}

LP_TEST(shared_cell_faces_use_one_common_diagonal) {
    // Conforming tetrahedralization: for every pair of neighboring cells,
    // the high face of one and the low face of the other are triangulated
    // with the same diagonal. Compare diagonals in face-local 2D coordinates
    // so vertex numbering on the two sides cannot cause false mismatches.
    constexpr int kN = 3;
    ProbeVolume volume(Vec3(0, 0, 0), Vec3(1, 1, 1), {{kN, kN, kN}});
    assignUniform(volume, Rgb(1, 1, 1));

    // Returns the face-local 2D endpoints of the diagonal drawn on one cell
    // face, encoded as ((u1,v1),(u2,v2)) with u,v the two free axes.
    auto cellFaceDiagonal = [&](int cx, int cy, int cz, int axis,
                                bool highFace) {
        std::array<int, 3> cell{cx, cy, cz};
        int fixed = cell[axis] + (highFace ? 1 : 0);
        int freeAxisA = (axis + 1) % 3;
        int freeAxisB = (axis + 2) % 3;
        std::set<std::pair<std::pair<int, int>, std::pair<int, int>>>
            diagonals;
        for (const Tetrahedron& tet : volume.tetrahedra()) {
            if (tet.cellX != cx || tet.cellY != cy || tet.cellZ != cz) {
                continue;
            }
            std::vector<Vec3> onFace;
            for (int id : tet.probeIndex) {
                const Vec3& position = volume.probes()[id].position;
                if (lp_test::nearlyEqual(position[axis],
                                         static_cast<float>(fixed), 1e-3f)) {
                    onFace.push_back(position);
                }
            }
            if (onFace.size() != 3) continue;
            for (int i = 0; i < 3; ++i) {
                for (int j = i + 1; j < 3; ++j) {
                    const Vec3& a = onFace[i];
                    const Vec3& b = onFace[j];
                    if (!lp_test::nearlyEqual(a[freeAxisA], b[freeAxisA],
                                              1e-3f) &&
                        !lp_test::nearlyEqual(a[freeAxisB], b[freeAxisB],
                                              1e-3f)) {
                        std::pair<int, int> p1 =
                            std::make_pair(
                                static_cast<int>(std::lround(a[freeAxisA])) -
                                    cell[freeAxisA],
                                static_cast<int>(std::lround(a[freeAxisB])) -
                                    cell[freeAxisB]);
                        std::pair<int, int> p2 = std::make_pair(
                            static_cast<int>(std::lround(b[freeAxisA])) -
                                cell[freeAxisA],
                            static_cast<int>(std::lround(b[freeAxisB])) -
                                cell[freeAxisB]);
                        if (p2 < p1) std::swap(p1, p2);
                        diagonals.insert({p1, p2});
                    }
                }
            }
        }
        return diagonals;
    };

    int checked = 0;
    for (int axis = 0; axis < 3; ++axis) {
        for (int a = 0; a < kN - 1; ++a) {
            for (int b = 0; b < kN - 1; ++b) {
                std::array<int, 3> low{0, 0, 0};
                std::array<int, 3> high{0, 0, 0};
                low[axis] = 0;
                high[axis] = 1;
                low[(axis + 1) % 3] = a;
                low[(axis + 2) % 3] = b;
                high[(axis + 1) % 3] = a;
                high[(axis + 2) % 3] = b;
                auto left = cellFaceDiagonal(low[0], low[1], low[2], axis,
                                              true);
                auto right = cellFaceDiagonal(high[0], high[1], high[2],
                                               axis, false);
                LP_CHECK(left.size() == 1);
                LP_CHECK(left == right);
                ++checked;
            }
        }
    }
    LP_CHECK(checked == 3 * (kN - 1) * (kN - 1));
}

LP_TEST(color_is_continuous_across_a_cell_boundary_face) {
    // Two adjacent cells sharing the x=1 plane. A continuous linear field on
    // the conforming tetrahedralization must evaluate identically when the
    // point is approached from either side, because both tets share the face
    // and use the same two face vertices.
    ProbeVolume volume(Vec3(0, 0, 0), Vec3(1, 1, 1), {{3, 2, 2}});
    for (Probe& probe : volume.probes()) {
        probe.zoneId = 0;
        probe.visibility = 1.0f;
        probe.exposureBias = 0.0f;
        probe.color = Rgb(probe.position.x, probe.position.y,
                          probe.position.z);
    }
    ProbeSampler sampler(volume, {}, Rgb(0, 0, 0), 0);

    SampleResult left = sampler.sample(Vec3(0.9999f, 0.4f, 0.6f), 0.016f);
    SampleResult right = sampler.sample(Vec3(1.0001f, 0.4f, 0.6f), 0.016f);
    LP_CHECK(left.mode == SampleMode::Tetrahedral);
    LP_CHECK(right.mode == SampleMode::Tetrahedral);
    // The sample points are 2e-4 apart in space, so an exact linear field can
    // differ by at most that much; the key assertion is continuity (no seam
    // offset), not bit-identical output.
    LP_CHECK(std::fabs(left.color.r - right.color.r) < 1e-3f);
    LP_CHECK(std::fabs(left.color.g - right.color.g) < 1e-3f);
    LP_CHECK(std::fabs(left.color.b - right.color.b) < 1e-3f);
    LP_CHECK_NEAR(left.color.r, 1.0f);
    LP_CHECK_NEAR(left.color.g, 0.4f);
    LP_CHECK_NEAR(left.color.b, 0.6f);
}

LP_TEST(raycast_wall_blocks_line_of_sight) {
    Box wall{{1.45f, -0.1f, -0.1f}, {1.55f, 2.1f, 2.1f}};
    LP_CHECK(wall.blocksLineOfSight(Vec3(0.5f, 0.5f, 0.5f),
                                    Vec3(2.5f, 0.5f, 0.5f)));
    LP_CHECK(!wall.blocksLineOfSight(Vec3(0.5f, 0.5f, 0.5f),
                                     Vec3(1.2f, 0.5f, 0.5f)));
    // Segment parallel to the wall, inside the left room.
    LP_CHECK(!wall.blocksLineOfSight(Vec3(0.2f, 0.5f, 0.5f),
                                     Vec3(1.2f, 0.5f, 0.5f)));
    // Endpoint touching the wall surface must not count as an intersection.
    LP_CHECK(!wall.blocksLineOfSight(Vec3(1.45f, 0.5f, 0.5f),
                                     Vec3(1.0f, 0.5f, 0.5f)));
}

LP_TEST(occluded_probes_are_dropped_and_weights_renormalize) {
    TwoRoomScene scene = buildTwoRoomScene();
    ProbeSampler sampler(*scene.volume, scene.walls, scene.fallbackColor,
                         scene.fallbackZone);
    // Object in the left room at x=0.5; the tet there only contains probes
    // from columns 0 and 1, all with line of sight.
    SampleResult open = sampler.sample(Vec3(0.5f, 0.5f, 0.5f), 0.016f);
    LP_CHECK(open.mode == SampleMode::Tetrahedral);
    float openSum = 0.0f;
    for (int id : open.tetraProbeIds) openSum += open.perProbeWeight[id];
    LP_CHECK_NEAR(openSum, 1.0f);

    // Place the object at x=1.25 in the left room. Its geometric tet can
    // include bright-room probes on the far side of the wall; those must be
    // hard-rejected by the zone filter so only left-zone probes receive
    // weight and the renormalized contributions still sum to one.
    SampleResult nearWall = sampler.sample(Vec3(1.25f, 0.5f, 0.5f), 0.016f);
    LP_CHECK(nearWall.mode == SampleMode::Tetrahedral);
    float contributingWeight = 0.0f;
    for (std::size_t id = 0;
         id < nearWall.perProbeWeight.size(); ++id) {
        float weight = nearWall.perProbeWeight[id];
        if (weight > 0.0f) {
            LP_CHECK(scene.volume->probes()[id].zoneId ==
                     TwoRoomScene::kLeftZone);
            contributingWeight += weight;
        }
    }
    LP_CHECK_NEAR(contributingWeight, 1.0f);
    for (int corner = 0; corner < 4; ++corner) {
        int id = nearWall.tetraProbeIds[corner];
        if (scene.volume->probes()[id].zoneId !=
            TwoRoomScene::kLeftZone) {
            LP_CHECK(!nearWall.tetraAvailable[corner]);
            LP_CHECK(nearWall.tetraWeights[corner] == 0.0f);
        }
    }
}

LP_TEST(no_light_leaks_from_bright_room_across_the_wall) {
    TwoRoomScene scene = buildTwoRoomScene();
    ProbeSampler sampler(*scene.volume, scene.walls, scene.fallbackColor,
                         scene.fallbackZone);

    // Sample right next to the wall on the left side for many frames, so
    // visibility state fully settles.
    SampleResult result;
    for (int frame = 0; frame < 120; ++frame) {
        result = sampler.sample(Vec3(1.2f, 0.5f, 0.5f), 0.016f);
    }
    LP_CHECK(result.zoneId == TwoRoomScene::kLeftZone);
    for (std::size_t id = 0; id < result.perProbeWeight.size(); ++id) {
        float weight = result.perProbeWeight[id];
        if (weight > 0.0f) {
            LP_CHECK(scene.volume->probes()[id].zoneId ==
                     TwoRoomScene::kLeftZone);
        }
    }
    // The bright room's minimum normalized color channel is far above the
    // dim room's maximum; the blended result must stay within the dim range.
    Rgb dimMax = TwoRoomScene::leftRoomColor(Vec3(0, 1, 0));
    LP_CHECK(result.color.r <= dimMax.r + kEps);
    LP_CHECK(result.color.g <= dimMax.g + kEps);
    LP_CHECK(result.color.b <= dimMax.b + kEps);
}

LP_TEST(crossing_the_wall_never_produces_a_single_frame_pop) {
    TwoRoomScene scene = buildTwoRoomScene();
    ProbeSampler sampler(*scene.volume, scene.walls, scene.fallbackColor,
                         scene.fallbackZone);

    const float dt = 1.0f / 60.0f;
    Rgb previous = sampler.sample(Vec3(0.5f, 0.5f, 0.5f), dt).color;
    float largestStep = 0.0f;
    bool crossedZones = false;
    int previousZone = TwoRoomScene::kLeftZone;
    for (int step = 1; step <= 150; ++step) {
        float x = 0.5f + step * (3.0f / 150.0f);
        SampleResult current = sampler.sample(Vec3(x, 0.5f, 0.5f), dt);
        if (current.zoneId != previousZone) crossedZones = true;
        previousZone = current.zoneId;
        float frameStep = std::fabs(current.color.r - previous.r);
        largestStep = std::max(largestStep, frameStep);
        LP_CHECK(std::isfinite(current.color.r));
        previous = current.color;
    }
    LP_CHECK(crossedZones);
    // Without temporal smoothing the zone flip alone jumps ~0.1 in one frame;
    // the output EMA at 60 FPS must keep every step well below that.
    LP_CHECK(largestStep < 0.02f);
}

LP_TEST(exposure_bias_is_normalized_before_blending) {
    ProbeVolume volume(Vec3(0, 0, 0), Vec3(1, 1, 1), {{2, 2, 2}});
    for (Probe& probe : volume.probes()) {
        probe.zoneId = 0;
        probe.visibility = 1.0f;
        probe.color = Rgb(2.0f, 2.0f, 2.0f);
        probe.exposureBias = 1.0f; // baked one stop brighter
    }
    ProbeSampler sampler(volume, {}, Rgb(0, 0, 0), 0);
    SampleResult result = sampler.sample(Vec3(0.5f, 0.5f, 0.5f), 0.016f);
    LP_CHECK(result.mode == SampleMode::Tetrahedral);
    LP_CHECK_NEAR(result.color.r, 1.0f);
    LP_CHECK_NEAR(result.color.g, 1.0f);
    LP_CHECK_NEAR(result.color.b, 1.0f);
    LP_CHECK_NEAR(result.exposureBias, 1.0f);
}

LP_TEST(visibility_fades_smoothly_without_weight_pops) {
    TwoRoomScene scene = buildTwoRoomScene();
    const Vec3 objectPosition(1.2f, 0.5f, 0.5f);

    ProbeSampler openSampler(*scene.volume, scene.walls,
                             scene.fallbackColor, scene.fallbackZone);
    for (int frame = 0; frame < 30; ++frame) {
        openSampler.sample(objectPosition, 0.016f);
    }

    // A temporary partition inside the left room blocks line of sight to one
    // of the four tet probes (the column x=1, low-z row). It stays clear of
    // the other three, so the tet stays valid with one probe fading out.
    std::vector<Box> occludingWalls = scene.walls;
    occludingWalls.push_back(
        Box{{1.08f, -0.05f, -0.05f}, {1.12f, 2.05f, 0.45f}});
    ProbeSampler sampler(*scene.volume, occludingWalls,
                         scene.fallbackColor, scene.fallbackZone);

    SampleResult first = sampler.sample(objectPosition, 0.016f);
    LP_CHECK(first.mode == SampleMode::Tetrahedral);
    Rgb previous = first.color;

    float largestStep = 0.0f;
    int fadedProbes = 0;
    for (int frame = 0; frame < 90; ++frame) {
        SampleResult current = sampler.sample(objectPosition, 0.016f);
        LP_CHECK(current.mode == SampleMode::Tetrahedral);
        float step = std::fabs(current.color.r - previous.r);
        largestStep = std::max(largestStep, step);
        LP_CHECK(std::isfinite(current.color.r));
        previous = current.color;
        for (int corner = 0; corner < 4; ++corner) {
            if (current.tetraVisibility[corner] < 0.02f) ++fadedProbes;
        }
    }
    // At least one probe must have faded all the way out, proving the
    // occlusion path was exercised.
    LP_CHECK(fadedProbes > 0);
    // An instant hard drop would step the color by a large fraction of the
    // room's color range; exponential fading keeps every step small.
    LP_CHECK(largestStep < 0.01f);
}

LP_TEST(all_probes_unavailable_uses_explicit_fallback_no_nan) {
    TwoRoomScene scene = buildTwoRoomScene();
    // Build a sealed chamber around the object out of three extra panels:
    // one vertical panel toward the x=0 probe column plus a floor and ceiling
    // panel covering the x=1 column. Together with the main dividing wall
    // they block line of sight to every probe of the left zone.
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
        result = sampler.sample(Vec3(1.0f, 0.5f, 0.5f), 0.016f);
    }
    LP_CHECK(result.mode == SampleMode::ExplicitFallback);
    LP_CHECK_NEAR(result.color.r, scene.fallbackColor.r);
    LP_CHECK_NEAR(result.color.g, scene.fallbackColor.g);
    LP_CHECK_NEAR(result.color.b, scene.fallbackColor.b);
    LP_CHECK(std::isfinite(result.color.r));
    LP_CHECK(result.weightSum == 0.0f);
    for (float weight : result.perProbeWeight) LP_CHECK(weight == 0.0f);

    // Even with the whole right room available and bright, it must not be
    // sampled as a substitute.
    LP_CHECK(result.zoneId == TwoRoomScene::kLeftZone);
}

LP_TEST(nearest_probe_fallback_inside_lattice_zone_is_respected) {
    ProbeVolume volume(Vec3(0, 0, 0), Vec3(1, 1, 1), {{2, 2, 2}});
    for (Probe& probe : volume.probes()) {
        probe.color = Rgb(0.4f, 0.4f, 0.4f);
        probe.visibility = 1.0f;
        probe.exposureBias = 0.0f;
    }
    // Split the cube down the middle into two zones with a sealing wall.
    for (Probe& probe : volume.probes()) {
        probe.zoneId = probe.position.x < 0.5f ? 0 : 1;
        if (probe.zoneId == 1) {
            probe.color = Rgb(4.0f, 4.0f, 4.0f);
        }
    }
    std::vector<Box> walls{
        Box{{0.49f, -0.01f, -0.01f}, {0.51f, 1.01f, 1.01f}}};
    ProbeSampler sampler(volume, walls, Rgb(0.01f, 0.01f, 0.01f), -1);

    SampleResult result = sampler.sample(Vec3(-0.5f, 0.5f, 0.5f), 0.016f);
    LP_CHECK(!result.insideVolume);
    LP_CHECK(result.mode == SampleMode::NearestProbe);
    LP_CHECK(result.zoneId == 0);
    LP_CHECK_NEAR(result.color.r, 0.4f);
}

LP_TEST(samplers_sharing_a_volume_keep_independent_visibility_state) {
    TwoRoomScene scene = buildTwoRoomScene();
    ProbeSampler wallSampler(*scene.volume, scene.walls,
                             scene.fallbackColor, scene.fallbackZone);
    ProbeSampler openSampler(*scene.volume, scene.walls,
                             scene.fallbackColor, scene.fallbackZone);
    const Vec3 nearWall(1.2f, 0.5f, 0.5f);

    // Drive one sampler for many frames so its wall-facing probes fade out.
    for (int frame = 0; frame < 120; ++frame) {
        wallSampler.sample(nearWall, 0.016f);
    }
    // The second sampler never ran: its first frame must still see every
    // same-zone probe at full availability and produce weight sum one.
    SampleResult fresh = openSampler.sample(nearWall, 0.016f);
    LP_CHECK(fresh.mode == SampleMode::Tetrahedral);
    float normalizedSum = 0.0f;
    for (float weight : fresh.perProbeWeight) normalizedSum += weight;
    LP_CHECK_NEAR(normalizedSum, 1.0f);
    for (int corner = 0; corner < 4; ++corner) {
        if (fresh.tetraAvailable[corner]) {
            LP_CHECK_NEAR(fresh.tetraVisibility[corner], 1.0f);
        }
    }

    // The driven sampler's result must remain deterministic and finite.
    SampleResult settled = wallSampler.sample(nearWall, 0.016f);
    LP_CHECK(std::isfinite(settled.color.r));
    LP_CHECK(settled.zoneId == TwoRoomScene::kLeftZone);
}

int main() { return lp_test::runAll(); }
