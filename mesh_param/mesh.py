"""Triangle mesh container, OBJ I/O and disk-topology validation."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


class TopologyError(ValueError):
    """Raised when the mesh violates the disk-topology assumption."""


@dataclass
class Mesh:
    """A triangle mesh with optional UV coordinates."""

    vertices: np.ndarray  # (n, 3) float
    faces: np.ndarray  # (m, 3) int
    uvs: np.ndarray | None = None  # (n, 2) float, per-vertex
    name: str = "mesh"
    boundary_loops: list[list[int]] = field(default_factory=list)

    # ------------------------------------------------------------------ I/O
    @classmethod
    def load_obj(cls, path: str) -> "Mesh":
        verts, faces = [], []
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                parts = line.split()
                if not parts:
                    continue
                if parts[0] == "v":
                    verts.append([float(x) for x in parts[1:4]])
                elif parts[0] == "f":
                    face = []
                    for tok in parts[1:]:
                        idx = int(tok.split("/")[0])
                        face.append(idx - 1 if idx > 0 else len(verts) + idx)
                    if len(face) != 3:
                        raise ValueError(
                            f"{path}: only triangle faces are supported, "
                            f"got {len(face)} vertices in one face"
                        )
                    faces.append(face)
        mesh = cls(
            vertices=np.asarray(verts, dtype=float),
            faces=np.asarray(faces, dtype=int),
            name=path,
        )
        return mesh

    def save_obj(self, path: str) -> None:
        """Write OBJ; includes ``vt`` lines and v/vt faces when UVs exist."""
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(f"# parameterized by mesh_param ({self.name})\n")
            for v in self.vertices:
                fh.write(f"v {v[0]:.8f} {v[1]:.8f} {v[2]:.8f}\n")
            if self.uvs is not None:
                for t in self.uvs:
                    fh.write(f"vt {t[0]:.8f} {t[1]:.8f}\n")
                for f in self.faces:
                    a, b, c = f + 1
                    fh.write(f"f {a}/{a} {b}/{b} {c}/{c}\n")
            else:
                for f in self.faces:
                    a, b, c = f + 1
                    fh.write(f"f {a} {b} {c}\n")

    # ------------------------------------------------------------- topology
    def edges(self) -> dict[tuple[int, int], list[int]]:
        """Map undirected edge -> list of incident face indices."""
        table: dict[tuple[int, int], list[int]] = {}
        for fi, (a, b, c) in enumerate(self.faces):
            for e in ((a, b), (b, c), (c, a)):
                key = (min(e), max(e))
                table.setdefault(key, []).append(fi)
        return table

    def validate_disk(self) -> list[list[int]]:
        """Check disk topology; return the single boundary loop.

        Raises TopologyError with a precise reason otherwise. Holes are
        reported, never silently filled.
        """
        v_count = len(self.vertices)
        if v_count == 0 or len(self.faces) == 0:
            raise TopologyError("mesh is empty")
        if self.faces.min() < 0 or self.faces.max() >= v_count:
            raise TopologyError("face indices out of range")

        edge_table = self.edges()

        nonmanifold = [e for e, fs in edge_table.items() if len(fs) > 2]
        if nonmanifold:
            raise TopologyError(
                f"non-manifold edges detected ({len(nonmanifold)} edges shared "
                f"by more than 2 triangles), e.g. edge {nonmanifold[0]}"
            )

        boundary_edges = [e for e, fs in edge_table.items() if len(fs) == 1]
        loops = self._trace_loops(boundary_edges)

        chi = v_count - len(edge_table) + len(self.faces)
        if len(loops) == 0:
            raise TopologyError(
                "mesh has no boundary (closed surface); a disk-topology "
                "patch with a boundary is required"
            )
        if len(loops) > 1:
            raise TopologyError(
                f"mesh has {len(loops)} boundary loops: 1 outer boundary plus "
                f"{len(loops) - 1} interior hole(s). Disk topology requires "
                "exactly one boundary loop; holes are not filled "
                "automatically. Loop sizes: "
                + ", ".join(str(len(l)) for l in loops)
            )
        if chi != 1:
            raise TopologyError(
                f"Euler characteristic V-E+F = {chi} != 1; the mesh is not "
                "topologically a disk (possible handles or disconnected parts)"
            )
        self.boundary_loops = loops
        return loops

    @staticmethod
    def _trace_loops(boundary_edges: list[tuple[int, int]]) -> list[list[int]]:
        adj: dict[int, list[int]] = {}
        for a, b in boundary_edges:
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
        loops: list[list[int]] = []
        visited: set[tuple[int, int]] = set()
        for start in adj:
            for nxt in adj[start]:
                if (start, nxt) in visited or (nxt, start) in visited:
                    continue
                loop = [start]
                prev, cur = start, nxt
                visited.add((prev, cur))
                visited.add((cur, prev))
                while cur != start:
                    loop.append(cur)
                    candidates = [x for x in adj[cur] if x != prev]
                    if not candidates:
                        break
                    nxt2 = candidates[0]
                    visited.add((cur, nxt2))
                    visited.add((nxt2, cur))
                    prev, cur = cur, nxt2
                loops.append(loop)
        return loops
