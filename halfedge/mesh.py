"""Half-edge topology: vertices, directed half-edges, twin and next links."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .geometry import EPS, Point, Segment, split_segments


@dataclass
class Vertex:
    vid: int
    x: float
    y: float


@dataclass
class Edge:
    eid: int
    he_forward: int
    he_backward: int
    sources: list[int] = field(default_factory=list)


@dataclass
class HalfEdge:
    hid: int
    origin: int
    twin: int = -1
    next: int = -1
    face: int = -1
    edge: int = -1


@dataclass
class Face:
    fid: int
    loops: list[list[int]]
    bounded: bool
    area: float


class HalfEdgeMesh:
    def __init__(self) -> None:
        self.vertices: list[Vertex] = []
        self.edges: list[Edge] = []
        self.halfedges: list[HalfEdge] = []
        self.faces: list[Face] = []
        self._vertex_index: dict[tuple[float, float], int] = {}

    def vertex_point(self, vid: int) -> Point:
        v = self.vertices[vid]
        return Point(v.x, v.y)

    def destination(self, hid: int) -> int:
        return self.halfedges[self.halfedges[hid].twin].origin

    def _vertex(self, p: Point) -> int:
        vid = self._vertex_index.get(p.key)
        if vid is None:
            vid = len(self.vertices)
            self.vertices.append(Vertex(vid, p.x, p.y))
            self._vertex_index[p.key] = vid
        return vid

    def _link_next_rings(self) -> None:
        """Sort outgoing half-edges by angle and wire next pointers.

        For an incoming half-edge ``h`` the next edge along its left face is
        the predecessor of ``twin(h)`` inside the CCW outgoing ring at the
        destination vertex.
        """
        outgoing: dict[int, list[int]] = {v.vid: [] for v in self.vertices}
        for he in self.halfedges:
            outgoing[he.origin].append(he.hid)

        for ring in outgoing.values():
            def angle(hid: int) -> float:
                he = self.halfedges[hid]
                dst = self.vertex_point(self.destination(hid))
                org = self.vertex_point(he.origin)
                return math.atan2(dst.y - org.y, dst.x - org.x)

            ring.sort(key=angle)
            # The incoming half-edge twin(ring[k]) ends at this vertex; its
            # left-face successor is the predecessor of ring[k] in the CCW
            # outgoing ring, i.e. ring[k-1].
            for k, hid in enumerate(ring):
                incoming = self.halfedges[hid].twin
                self.halfedges[incoming].next = ring[(k - 1) % len(ring)]


def build_mesh(segments: list[Segment]) -> HalfEdgeMesh:
    """Build the full half-edge mesh from raw input segments."""
    mesh = HalfEdgeMesh()
    atomic = split_segments(segments)
    edge_index: dict[tuple[int, int], int] = {}

    for p, q, source in atomic:
        u, v = mesh._vertex(p), mesh._vertex(q)
        if u == v:
            continue
        key = (u, v) if u < v else (v, u)
        existing = edge_index.get(key)
        if existing is not None:
            mesh.edges[existing].sources.append(source)
            continue

        eid = len(mesh.edges)
        h0 = len(mesh.halfedges)
        h1 = h0 + 1
        edge_index[key] = eid
        mesh.edges.append(Edge(eid, h0, h1, [source]))
        mesh.halfedges.append(HalfEdge(h0, origin=u, twin=h1, edge=eid))
        mesh.halfedges.append(HalfEdge(h1, origin=v, twin=h0, edge=eid))

    mesh._link_next_rings()
    from .faces import extract_faces
    extract_faces(mesh)
    return mesh
