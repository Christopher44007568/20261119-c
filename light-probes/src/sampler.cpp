#include "lp/sampler.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace lp {

namespace {
float approach(float current, float target, float rate, float dt) {
    float alpha = 1.0f - std::exp(-rate * dt);
    alpha = std::clamp(alpha, 0.0f, 1.0f);
    return current + (target - current) * alpha;
}
} // namespace

ProbeSampler::ProbeSampler(const ProbeVolume& volume, std::vector<Box> walls,
                           Rgb fallbackColor, int fallbackZone,
                           SamplerSettings settings)
    : volume_(volume),
      walls_(std::move(walls)),
      fallbackColor_(fallbackColor),
      fallbackZone_(fallbackZone),
      settings_(settings),
      visibility_(volume.probes().size(), 1.0f) {}

void ProbeSampler::resetVisibility() {
    std::fill(visibility_.begin(), visibility_.end(), 1.0f);
    hasSmoothedColor_ = false;
}

bool ProbeSampler::isOccluded(const Vec3& objectPosition,
                              const Vec3& probePosition) const {
    for (const Box& wall : walls_) {
        if (wall.blocksLineOfSight(objectPosition, probePosition)) {
            return true;
        }
    }
    return false;
}

void ProbeSampler::updateVisibility(int probeId, bool occluded, float dt) {
    float target = occluded ? 0.0f : 1.0f;
    float rate = occluded ? settings_.fadeOutRate : settings_.fadeInRate;
    visibility_[probeId] = approach(visibility_[probeId], target, rate, dt);
}

int ProbeSampler::resolveZone(const Vec3& objectPosition,
                              const Tetrahedron* tet) const {
    if (tet != nullptr) {
        // Inside the lattice the object's room is whatever zone its local
        // probes agree on; disagreement means it is straddling a wall cell,
        // which the call site handles by occlusion filtering.
        int zone = -1;
        bool consistent = true;
        for (int id : tet->probeIndex) {
            int probeZone = volume_.probes()[id].zoneId;
            if (zone == -1) zone = probeZone;
            else if (zone != probeZone) consistent = false;
        }
        if (consistent) return zone;
    }
    // Outside the lattice (or a mixed wall cell): derive the zone from the
    // geometrically nearest probe, never from a neighbor across a wall.
    int best = -1;
    float bestDistSq = std::numeric_limits<float>::infinity();
    for (const Probe& probe : volume_.probes()) {
        Vec3 delta = probe.position - objectPosition;
        float distSq = Vec3::dot(delta, delta);
        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = probe.id;
        }
    }
    return best == -1 ? fallbackZone_ : volume_.probes()[best].zoneId;
}

std::vector<ProbeSampler::Candidate> ProbeSampler::collectCandidates(
    const Tetrahedron* tet, const std::array<float, 4>& bary,
    const Vec3& objectPosition, int zoneId, float dt) {
    std::vector<Candidate> candidates;
    candidates.reserve(4);
    for (int corner = 0; corner < 4; ++corner) {
        int probeId = tet->probeIndex[corner];
        const Probe& probe = volume_.probes()[probeId];
        bool occluded = isOccluded(objectPosition, probe.position);
        updateVisibility(probeId, occluded, dt);

        // A probe from another room can never contribute, no matter how
        // bright it is: this is the hard anti-light-leak rule.
        bool wrongZone = settings_.restrictToSameZone && probe.zoneId != zoneId;
        if (wrongZone) continue;

        // Within the same room, an occluded probe fades out through its
        // smoothed visibility instead of being dropped on one frame, so an
        // object crossing an interpolation face never gets a color pop.
        if (visibility_[probeId] < settings_.visibilityCutoff) continue;

        float visibilityFactor =
            std::pow(visibility_[probeId], settings_.visibilityPower);
        candidates.push_back(
            {probeId, bary[corner] * visibilityFactor, bary[corner],
             visibility_[probeId], occluded});
    }
    return candidates;
}

Rgb ProbeSampler::normalizedProbeColor(const Probe& probe) const {
    // Convert the baked color into the common exposure space. Baking at
    // exposure bias b (stops) scales radiance by 2^b, so dividing removes the
    // capture-time exposure difference before any blending happens.
    return probe.color * std::exp2(-probe.exposureBias);
}

bool ProbeSampler::blendCandidates(
    const std::vector<Candidate>& candidates, SampleResult& result) const {
    float sum = 0.0f;
    for (const Candidate& candidate : candidates) sum += candidate.weight;
    if (!(sum > 0.0f) || !std::isfinite(sum)) {
        // Explicit guard against divide-by-zero / NaN: the caller must take
        // the fallback path rather than renormalizing an empty weight set.
        return false;
    }

    Rgb accumulated{0.0f, 0.0f, 0.0f};
    float exposureAccum = 0.0f;
    for (const Candidate& candidate : candidates) {
        float normalizedWeight = candidate.weight / sum;
        const Probe& probe = volume_.probes()[candidate.probeId];
        accumulated += normalizedProbeColor(probe) * normalizedWeight;
        // Blend exposure in stops (a log-space quantity) with the same
        // weights, so reconstructing with 2^exposureBias stays continuous.
        exposureAccum += probe.exposureBias * normalizedWeight;
        result.perProbeWeight[candidate.probeId] = normalizedWeight;
    }
    for (int corner = 0; corner < 4; ++corner) {
        int probeId = result.tetraProbeIds[corner];
        if (probeId >= 0) result.tetraWeights[corner] =
                              result.perProbeWeight[probeId];
    }
    result.color = accumulated;
    result.exposureBias = exposureAccum;
    result.weightSum = sum;
    return true;
}

bool ProbeSampler::nearestSameZoneProbe(const Vec3& objectPosition, int zoneId,
                                        float dtSeconds,
                                        SampleResult& result) {
    int best = -1;
    float bestDistSq = std::numeric_limits<float>::infinity();
    for (const Probe& probe : volume_.probes()) {
        if (probe.zoneId != zoneId) continue;
        bool occluded = isOccluded(objectPosition, probe.position);
        updateVisibility(probe.id, occluded, dtSeconds);
        if (occluded || visibility_[probe.id] < settings_.visibilityCutoff) {
            continue;
        }
        Vec3 delta = probe.position - objectPosition;
        float distSq = Vec3::dot(delta, delta);
        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = probe.id;
        }
    }
    if (best == -1) return false;
    const Probe& probe = volume_.probes()[best];
    result.mode = SampleMode::NearestProbe;
    result.color = normalizedProbeColor(probe);
    result.exposureBias = probe.exposureBias;
    result.weightSum = 1.0f;
    result.perProbeWeight[best] = 1.0f;
    return true;
}

SampleResult ProbeSampler::sample(const Vec3& objectPosition, float dtSeconds) {
    SampleResult result;
    result.perProbeWeight.assign(volume_.probes().size(), 0.0f);

    const Tetrahedron* tet = nullptr;
    std::array<float, 4> bary{{0.0f, 0.0f, 0.0f, 0.0f}};
    result.insideVolume = volume_.locate(objectPosition, tet, bary);

    int zoneId = resolveZone(objectPosition, tet);
    result.zoneId = zoneId;

    if (result.insideVolume && tet != nullptr) {
        result.tetraProbeIds = tet->probeIndex;
        result.tetraBarycentric = bary;
        std::vector<Candidate> candidates =
            collectCandidates(tet, bary, objectPosition, zoneId, dtSeconds);
        for (int corner = 0; corner < 4; ++corner) {
            int probeId = tet->probeIndex[corner];
            const Probe& probe = volume_.probes()[probeId];
            bool sameZone = !settings_.restrictToSameZone ||
                            probe.zoneId == zoneId;
            // "Available" means hard-usable: same room and still above the
            // visibility cutoff. Current line-of-sight state is reported
            // separately via tetraVisibility for the debug HUD.
            result.tetraVisibility[corner] = visibility_[probeId];
            result.tetraAvailable[corner] =
                sameZone &&
                visibility_[probeId] >= settings_.visibilityCutoff;
        }
        if (blendCandidates(candidates, result)) {
            result.mode = SampleMode::Tetrahedral;
        }
    }

    // Outside the lattice, or every tet probe was rejected: same-zone nearest
    // probe. A bright probe in the adjacent room can never win this lookup.
    if (result.mode != SampleMode::Tetrahedral &&
        nearestSameZoneProbe(objectPosition, zoneId, dtSeconds, result)) {
        // result is now populated in NearestProbe mode.
    } else if (result.mode != SampleMode::Tetrahedral) {
        // Definite, explicit fallback. No weight normalization happens on
        // this path, so a zero denominator can never produce NaN or a
        // foreign-room tint.
        result.mode = SampleMode::ExplicitFallback;
        result.color = fallbackColor_;
        result.exposureBias = 0.0f;
        result.weightSum = 0.0f;
    }

    // Output-side temporal smoothing. Weighted colors can only change
    // discretely at a zone (room) boundary because the zone label itself is
    // discrete; an exponential approach keeps every per-frame step bounded
    // while converging to the exact instantaneous result within a few frames.
    if (!std::isfinite(settings_.colorSmoothingRate)) {
        hasSmoothedColor_ = false;
        return result;
    }
    if (!hasSmoothedColor_) {
        smoothedColor_ = result.color;
        smoothedExposure_ = result.exposureBias;
        hasSmoothedColor_ = true;
    } else {
        float alpha = 1.0f - std::exp(-settings_.colorSmoothingRate *
                                      dtSeconds);
        alpha = std::clamp(alpha, 0.0f, 1.0f);
        smoothedColor_ = smoothedColor_ +
                         (result.color - smoothedColor_) * alpha;
        smoothedExposure_ +=
            (result.exposureBias - smoothedExposure_) * alpha;
    }
    result.color = smoothedColor_;
    result.exposureBias = smoothedExposure_;
    return result;
}

} // namespace lp
