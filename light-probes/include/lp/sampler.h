#pragma once

#include <array>
#include <vector>

#include "lp/probe_volume.h"

namespace lp {

enum class SampleMode {
    // Barycentric interpolation over the four probes of the located tet.
    Tetrahedral = 0,
    // Object is outside the lattice: single nearest probe, same zone only.
    NearestProbe = 1,
    // No probe is usable; explicit caller-provided fallback color.
    ExplicitFallback = 2,
};

struct SamplerSettings {
    // Per-frame exponential approach rates for smoothed visibility.
    float fadeInRate = 6.0f;   // line of sight regained
    float fadeOutRate = 10.0f; // wall now blocks line of sight
    // Probes whose smoothed visibility is below this contribute nothing.
    float visibilityCutoff = 0.01f;
    // Exponent applied to visibility when forming blend weights. >1 makes
    // partially occluded probes yield quickly while the fade stays smooth.
    float visibilityPower = 1.0f;
    // Output-side temporal smoothing rate (1/seconds). The instantaneous
    // blend can still change discretely when the object crosses a wall and
    // its zone label flips; this EMA guarantees a bounded per-frame color
    // step even across that discrete transition. Set to infinity to disable.
    float colorSmoothingRate = 8.0f;
    // Never use probes from another zone, even if every local probe fails.
    // This is the anti-light-leak switch and is intentionally hard-wired on.
    bool restrictToSameZone = true;
};

struct SampleResult {
    SampleMode mode = SampleMode::ExplicitFallback;
    Rgb color{0.0f, 0.0f, 0.0f}; // final irradiance in the common exposure space
    float exposureBias = 0.0f;   // blended exposure (stops), for reconstruction
    bool insideVolume = false;
    int zoneId = -1;
    float weightSum = 0.0f;      // normalization denominator actually used

    // The four probes of the located tetrahedron (ids; -1 when outside the
    // volume). These are exactly the four weights the debug HUD must show.
    std::array<int, 4> tetraProbeIds{{-1, -1, -1, -1}};
    // Final normalized blend weights for the four tet probes (0 when the
    // probe is unavailable; the geometric barycentric coordinates are still
    // reported via tetraBarycentric).
    std::array<float, 4> tetraWeights{{0.0f, 0.0f, 0.0f, 0.0f}};
    std::array<float, 4> tetraBarycentric{{0.0f, 0.0f, 0.0f, 0.0f}};
    std::array<float, 4> tetraVisibility{{0.0f, 0.0f, 0.0f, 0.0f}};
    std::array<bool, 4> tetraAvailable{{false, false, false, false}};

    // Full per-probe contribution vector, indexed by Probe::id. Entries for
    // probes outside the located tet stay zero. No division by zero ever
    // occurs: when the sum is zero the explicit fallback path is taken.
    std::vector<float> perProbeWeight;
};

// Samples a ProbeVolume for a moving object, enforcing wall occlusion,
// exposure-consistent blending and deterministic fallbacks. One sampler owns
// the per-probe visibility state for one object; create one per dynamic object.
class ProbeSampler {
public:
    ProbeSampler(const ProbeVolume& volume, std::vector<Box> walls,
                 Rgb fallbackColor, int fallbackZone,
                 SamplerSettings settings = {});

    const SamplerSettings& settings() const { return settings_; }
    const std::vector<Box>& walls() const { return walls_; }

    // Resets smoothed availability (e.g. on object respawn/teleport).
    void resetVisibility();

    // True when any wall blocks the open segment from objectPosition to the
    // probe position.
    bool isOccluded(const Vec3& objectPosition, const Vec3& probePosition) const;

 // Main entry point. dtSeconds drives visibility smoothing; pass the frame
    // delta time (a fixed value is fine for deterministic tests).
    SampleResult sample(const Vec3& objectPosition, float dtSeconds);

private:
    struct Candidate {
        int probeId;
        float weight; // barycentric * visibility factor, pre-normalization
        float barycentric;
        float visibility;
        bool occluded;
    };

    void updateVisibility(int probeId, bool occluded, float dt);
    int resolveZone(const Vec3& objectPosition, const Tetrahedron* tet) const;
    std::vector<Candidate> collectCandidates(
        const Tetrahedron* tet, const std::array<float, 4>& bary,
        const Vec3& objectPosition, int zoneId, float dt);
    Rgb normalizedProbeColor(const Probe& probe) const;
    bool blendCandidates(const std::vector<Candidate>& candidates,
                         SampleResult& result) const;
    bool nearestSameZoneProbe(const Vec3& objectPosition, int zoneId,
                              float dtSeconds, SampleResult& result);

    const ProbeVolume& volume_;
    std::vector<Box> walls_;
    Rgb fallbackColor_;
    int fallbackZone_;
    SamplerSettings settings_;
    bool hasSmoothedColor_ = false;
    Rgb smoothedColor_;
    float smoothedExposure_ = 0.0f;
    // Per-object smoothed availability, indexed by Probe::id. Kept inside
    // the sampler so multiple dynamic objects sharing one ProbeVolume do not
    // overwrite each other's fade state.
    std::vector<float> visibility_;
};

} // namespace lp
