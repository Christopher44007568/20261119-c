"""Planar line-segment half-edge structure builder.

Pipeline:
  1. Split every input segment at all intersection / contact points.
  2. Merge collinear overlaps and deduplicate vertices and edges.
  3. Build twin half-edges and angle-sorted next rings around each vertex.
  4. Walk next-pointers into loops, group loops into bounded faces and the
     single unbounded outer face (holes supported).
"""

from .geometry import Point, Segment, split_segments
from .mesh import HalfEdgeMesh, build_mesh, Face

__all__ = [
    "Point",
    "Segment",
    "split_segments",
    "HalfEdgeMesh",
    "build_mesh",
    "Face",
]
