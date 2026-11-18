#pragma once

#include <cassert>
#include <cstddef>
#include <vector>

#include "lp/types.h"

namespace lp {

struct Probe {
    int id = -1;
    Vec3 position;
    // Baked linear HDR irradiance captured at this probe.
    Rgb color;
    // Exposure value difference applied when the probe was baked, in stops.
    // Positive means the probe was baked brighter; colors are divided by
    // 2^exposureBias so every probe lives in one common exposure space.
    float exposureBias = 0.0f;
    // Logical room/zone id. Probes that share a wall boundary never share a
    // zone; sampling only falls back to probes within the same zone.
    int zoneId = -1;

    // Initial availability in [0, 1]. The runtime smoothed state is owned
    // per-object by ProbeSampler (one entry per probe id), so that multiple
    // dynamic objects can share one volume without cross-talk.
    float visibility = 1.0f;
};

struct Tetrahedron {
    // Indices into ProbeVolume::probes().
    std::array<int, 4> probeIndex{{-1, -1, -1, -1}};
    // Inverse of the edge matrix [p1-p0 | p2-p0 | p3-p0]; barycentric
    // coordinates for a point p are (1 - s - t - u, s, t, u) with
    // (s, t, u)^T = inverse * (p - p0).
    std::array<std::array<float, 3>, 3> inverseEdgeMatrix{};
    int cellX = 0;
    int cellY = 0;
    int cellZ = 0;
};

// Regular cubic lattice of probes. Each cube cell is split into five
// tetrahedra: a central regular tetrahedron on the four corners of one bit
// parity plus four corner tetrahedra. The orientation alternates with the
// parity of the cell indices, so every face shared by two cells keeps one
// common face diagonal: the tetrahedralization is conforming and colors stay
// continuous (no seam pops) across cells and across the room wall.
class ProbeVolume {
public:
    ProbeVolume() = default;

    // counts[*] is the number of probes along each axis (>= 2).
    ProbeVolume(const Vec3& origin, const Vec3& spacing,
                std::array<int, 3> counts)
        : origin_(origin), spacing_(spacing), counts_(counts) {
        assert(counts[0] >= 2 && counts[1] >= 2 && counts[2] >= 2);
        build();
    }

 const std::vector<Probe>& probes() const { return probes_; }
    std::vector<Probe>& probes() { return probes_; }
    const std::vector<Tetrahedron>& tetrahedra() const { return tets_; }

    const Vec3& origin() const { return origin_; }
    const Vec3& spacing() const { return spacing_; }
    const std::array<int, 3>& counts() const { return counts_; }

    int probeIndexAt(int ix, int iy, int iz) const {
        if (ix < 0 || iy < 0 || iz < 0 ||
            ix >= counts_[0] || iy >= counts_[1] || iz >= counts_[2]) {
            return -1;
        }
        return ix * counts_[1] * counts_[2] + iy * counts_[2] + iz;
    }

    Vec3 probePosition(int ix, int iy, int iz) const {
        return {origin_.x + ix * spacing_.x,
                origin_.y + iy * spacing_.y,
                origin_.z + iz * spacing_.z};
    }

    // Finds the tetrahedron containing p together with raw (unoccluded)
    // barycentric weights. Returns false when p is outside the lattice; in
    // that case outWeights/outTet are untouched.
    bool locate(const Vec3& p, const Tetrahedron*& outTet,
                std::array<float, 4>& outWeights) const {
        std::array<int, 3> cell{};
        std::array<float, 3> local{};
        for (int axis = 0; axis < 3; ++axis) {
            float span = p[axis] - origin_[axis];
            float f = span / spacing_[axis];
            int c = static_cast<int>(std::floor(f));
            if (f < 0.0f || c >= counts_[axis] - 1) return false;
            cell[axis] = c;
            local[axis] = span - c * spacing_[axis];
        }
        const auto& cellTets = tetsByCell(cell[0], cell[1], cell[2]);
        for (int tetLocal = 0; tetLocal < 5; ++tetLocal) {
            const Tetrahedron& tet = tets_[cellTets[tetLocal]];
            if (barycentric(tet, probes_, p, outWeights)) {
                outTet = &tet;
                return true;
            }
        }
        // Points exactly on a face/edge can fail the epsilon test for all
        // five tets due to rounding; retry with the relaxed boundary test.
        for (int tetLocal = 0; tetLocal < 5; ++tetLocal) {
            const Tetrahedron& tet = tets_[cellTets[tetLocal]];
            if (barycentric(tet, probes_, p, outWeights, kRelaxedEps)) {
                outTet = &tet;
                return true;
            }
        }
        return false;
    }

    // Raw barycentric weights for an arbitrary tetrahedron; false when p is
    // outside (beyond epsilon tolerance).
    static bool barycentric(const Tetrahedron& tet,
                            const std::vector<Probe>& probes, const Vec3& p,
                            std::array<float, 4>& w,
                            float eps = kEps) {
        const Probe& p0 = probes[tet.probeIndex[0]];
        Vec3 d = p - p0.position;
        float s = tet.inverseEdgeMatrix[0][0] * d.x +
                  tet.inverseEdgeMatrix[0][1] * d.y +
                  tet.inverseEdgeMatrix[0][2] * d.z;
        float t = tet.inverseEdgeMatrix[1][0] * d.x +
                  tet.inverseEdgeMatrix[1][1] * d.y +
                  tet.inverseEdgeMatrix[1][2] * d.z;
        float u = tet.inverseEdgeMatrix[2][0] * d.x +
                  tet.inverseEdgeMatrix[2][1] * d.y +
                  tet.inverseEdgeMatrix[2][2] * d.z;
        float w0 = 1.0f - s - t - u;
        if (s < -eps || t < -eps || u < -eps || w0 < -eps) return false;
        w = {{std::max(0.0f, w0), std::max(0.0f, s),
              std::max(0.0f, t), std::max(0.0f, u)}};
        return true;
    }

private:
    static constexpr float kEps = 1e-4f;
    static constexpr float kRelaxedEps = 1e-3f;

    // Cube vertex bit ordering: bit 0 -> x, bit 1 -> y, bit 2 -> z.
    static constexpr std::array<std::array<int, 3>, 8> kCornerOffset = {{
        {{0, 0, 0}}, {{1, 0, 0}}, {{0, 1, 0}}, {{1, 1, 0}},
        {{0, 0, 1}}, {{1, 0, 1}}, {{0, 1, 1}}, {{1, 1, 1}},
    }};

    // Even-parity cube corners: 0(000), 3(011), 5(101), 6(110).
    // Odd-parity cube corners:  1(100), 2(010), 4(001), 7(111).
    // Each corner tet is one face of the central tet plus the opposite
    // parity corner lying beyond that face.
    static constexpr std::array<std::array<int, 4>, 5> kEvenTetCorners = {{
        {{0, 3, 5, 6}},
        {{0, 3, 5, 1}},
        {{0, 3, 6, 2}},
        {{0, 5, 6, 4}},
        {{3, 5, 6, 7}},
    }};
    // Odd orientation mirrors the central tet onto the odd corners.
    static constexpr std::array<std::array<int, 4>, 5> kOddTetCorners = {{
        {{1, 2, 4, 7}},
        {{1, 2, 4, 0}},
        {{1, 2, 7, 3}},
        {{1, 4, 7, 5}},
        {{2, 4, 7, 6}},
    }};

    std::size_t cellOffset(int cx, int cy, int cz) const {
        return static_cast<std::size_t>(
            (cx * (counts_[1] - 1) + cy) * (counts_[2] - 1) + cz) * 5;
    }

    const int* tetsByCell(int cx, int cy, int cz) const {
        return &cellTetOffset_[cellOffset(cx, cy, cz)];
    }

    void build() {
        probes_.reserve(counts_[0] * counts_[1] * counts_[2]);
        for (int ix = 0; ix < counts_[0]; ++ix) {
            for (int iy = 0; iy < counts_[1]; ++iy) {
                for (int iz = 0; iz < counts_[2]; ++iz) {
                    Probe probe;
                    probe.id = static_cast<int>(probes_.size());
                    probe.position = probePosition(ix, iy, iz);
                    probes_.push_back(probe);
                }
            }
        }

        int cellsX = counts_[0] - 1;
        int cellsY = counts_[1] - 1;
        int cellsZ = counts_[2] - 1;
        cellTetOffset_.resize(static_cast<std::size_t>(cellsX) * cellsY *
                              cellsZ * 5);

        for (int cx = 0; cx < cellsX; ++cx) {
            for (int cy = 0; cy < cellsY; ++cy) {
                for (int cz = 0; cz < cellsZ; ++cz) {
                    std::array<int, 8> cornerProbe{};
                    for (int v = 0; v < 8; ++v) {
                        cornerProbe[v] = probeIndexAt(
                            cx + kCornerOffset[v][0],
                            cy + kCornerOffset[v][1],
                            cz + kCornerOffset[v][2]);
                    }
                    int orientation = (cx + cy + cz) & 1;
                    const auto& table =
                        orientation ? kOddTetCorners : kEvenTetCorners;
                    for (int k = 0; k < 5; ++k) {
                        Tetrahedron tet;
                        for (int c = 0; c < 4; ++c) {
                            tet.probeIndex[c] = cornerProbe[table[k][c]];
                        }
                        tet.cellX = cx;
                        tet.cellY = cy;
                        tet.cellZ = cz;
                        fillInverse(tet);
                        cellTetOffset_[cellOffset(cx, cy, cz) + k] =
                            static_cast<int>(tets_.size());
                        tets_.push_back(tet);
                    }
                }
            }
        }
    }

    void fillInverse(Tetrahedron& tet) {
        const Vec3& p0 = probes_[tet.probeIndex[0]].position;
        Vec3 e1 = probes_[tet.probeIndex[1]].position - p0;
        Vec3 e2 = probes_[tet.probeIndex[2]].position - p0;
        Vec3 e3 = probes_[tet.probeIndex[3]].position - p0;
        Vec3 cross23 = Vec3::cross(e2, e3);
        Vec3 cross31 = Vec3::cross(e3, e1);
        Vec3 cross12 = Vec3::cross(e1, e2);
        float det = Vec3::dot(e1, cross23);
        assert(std::fabs(det) > 1e-12f);
        float invDet = 1.0f / det;
        // Rows of the inverse matrix (columns are the cross products above).
        tet.inverseEdgeMatrix[0] = {{cross23.x * invDet, cross23.y * invDet,
                                     cross23.z * invDet}};
        tet.inverseEdgeMatrix[1] = {{cross31.x * invDet, cross31.y * invDet,
                                     cross31.z * invDet}};
        tet.inverseEdgeMatrix[2] = {{cross12.x * invDet, cross12.y * invDet,
                                     cross12.z * invDet}};
    }

    Vec3 origin_;
    Vec3 spacing_;
    std::array<int, 3> counts_{};
    std::vector<Probe> probes_;
    std::vector<Tetrahedron> tets_;
    std::vector<int> cellTetOffset_;
};

} // namespace lp
