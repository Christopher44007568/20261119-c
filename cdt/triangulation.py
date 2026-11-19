"""Core triangulation engine: incremental insertion with Lawson flips.

Triangles are stored as CCW vertex-id triples in a dict; adjacency is
rebuilt lazily after structural changes.  The mesh starts from a super
triangle enclosing all input points, so point location never leaves the
mesh.  All orientation / incircle tests use exact predicates, which keeps
near-collinear and near-cocircular inputs robust.
"""

from .predicates import orient2d, incircle
from .geometry import circumcircle


class InsertionRecord:
    """What happened while inserting one vertex (for visualization)."""

    def __init__(self, point, vid):
        self.point = point
        self.vid = vid
        self.cavity = []        # triangle triples removed during insertion
        self.new_triangles = [] # triangle triples created
        self.flips = []         # ((u, v), (c, d)): edge uv flipped to cd
        self.circumcircles = [] # ((cx, cy), r) of final new triangles


class ConstraintRecord:
    """What happened while inserting one constraint segment."""

    def __init__(self, va, vb):
        self.va = va
        self.vb = vb
        self.crossed_edges = []   # edges removed by the segment walk
        self.cavity = []          # triangle triples removed
        self.new_triangles = []   # triangle triples created
        self.flips = []           # legalization flips inside the cavity


def _between(pa, pb, p):
    """True if p (known collinear with pa-pb) lies strictly between them."""
    if p == pa or p == pb:
        return False
    return (
        min(pa[0], pb[0]) <= p[0] <= max(pa[0], pb[0])
        and min(pa[1], pb[1]) <= p[1] <= max(pa[1], pb[1])
    )


def _strictly_in_triangle(pa, pb, pc, p):
    s = orient2d(pa, pb, pc)
    if s == 0:
        return False
    return (
        orient2d(pa, pb, p) * s > 0
        and orient2d(pb, pc, p) * s > 0
        and orient2d(pc, pa, p) * s > 0
    )


def _split_chains(boundary_edges, va, vb):
    """Split the cavity boundary (a simple polygon through va and vb) into
    the two ordered chains from va to vb."""
    adj = {}
    for u, v in boundary_edges:
        adj.setdefault(u, []).append(v)
        adj.setdefault(v, []).append(u)

    def walk(first_step):
        chain = [va]
        prev, cur = va, first_step
        while cur != vb:
            chain.append(cur)
            nxts = [w for w in adj[cur] if w != prev]
            prev, cur = cur, nxts[0]
        chain.append(vb)
        return chain

    return walk(adj[va][0]), walk(adj[va][1])


class Triangulation:
    def __init__(self):
        self.points = []          # vertex coordinates by id
        self._pid = {}            # coordinate -> vertex id (dedup)
        self.triangles = {}       # tid -> (a, b, c) CCW
        self._adj = {}            # tid -> (n0, n1, n2), neighbor opposite vi
        self._vtx_tri = {}        # vertex id -> one incident tid
        self._next_tid = 0
        self._dirty = True
        self.constrained = set()  # frozenset({u, v}) edges that may not flip
        self.super_vertices = set()

    # ------------------------------------------------------------------ #
    # basic structure
    # ------------------------------------------------------------------ #
    def add_point(self, p):
        key = (float(p[0]), float(p[1]))
        if key in self._pid:
            return self._pid[key]
        vid = len(self.points)
        self.points.append(key)
        self._pid[key] = vid
        return vid

    def _new_triangle(self, a, b, c):
        tid = self._next_tid
        self._next_tid += 1
        self.triangles[tid] = (a, b, c)
        self._dirty = True
        return tid

    def _drop_triangle(self, tid):
        del self.triangles[tid]
        self._dirty = True

    def _rebuild(self):
        edge_map = {}
        for tid, (a, b, c) in self.triangles.items():
            edge_map[(a, b)] = tid
            edge_map[(b, c)] = tid
            edge_map[(c, a)] = tid
        adj = {}
        vtx = {}
        for tid, (a, b, c) in self.triangles.items():
            adj[tid] = (
                edge_map.get((c, b)),   # edge opposite a is (b, c)
                edge_map.get((a, c)),   # edge opposite b is (c, a)
                edge_map.get((b, a)),   # edge opposite c is (a, b)
            )
            vtx[a] = tid
            vtx[b] = tid
            vtx[c] = tid
        self._adj = adj
        self._vtx_tri = vtx
        vtx_all = {}
        for tid, (a, b, c) in self.triangles.items():
            vtx_all.setdefault(a, []).append(tid)
            vtx_all.setdefault(b, []).append(tid)
            vtx_all.setdefault(c, []).append(tid)
        self._vtx_tris = vtx_all
        self._dirty = False

    def _ensure(self):
        if self._dirty:
            self._rebuild()

    def init_supertriangle(self, points):
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        cx = (min(xs) + max(xs)) / 2.0
        cy = (min(ys) + max(ys)) / 2.0
        r = max(max(xs) - min(xs), max(ys) - min(ys), 1.0)
        big = r * 100.0
        s0 = self.add_point((cx - big * 2.0, cy - big))
        s1 = self.add_point((cx + big * 2.0, cy - big))
        s2 = self.add_point((cx, cy + big * 2.0))
        self.super_vertices = {s0, s1, s2}
        self._new_triangle(s0, s1, s2)

    # ------------------------------------------------------------------ #
    # point location (visibility walk with linear-scan fallback)
    # ------------------------------------------------------------------ #
    def locate(self, p, hint=None):
        self._ensure()
        tid = hint if hint in self.triangles else None
        if tid is None:
            tid = next(iter(self.triangles))
        visited = set()
        while tid is not None and tid not in visited:
            visited.add(tid)
            a, b, c = self.triangles[tid]
            o0 = orient2d(self.points[b], self.points[c], p)
            o1 = orient2d(self.points[c], self.points[a], p)
            o2 = orient2d(self.points[a], self.points[b], p)
            if o0 >= 0 and o1 >= 0 and o2 >= 0:
                return tid
            # cross the edge opposite the most negative test
            tests = (o0, o1, o2)
            edge = min(range(3), key=lambda i: tests[i])
            tid = self._adj[tid][edge]
        # fallback: brute scan (robust against walk cycles)
        for tid, (a, b, c) in self.triangles.items():
            pa, pb, pc = self.points[a], self.points[b], self.points[c]
            if (
                orient2d(pa, pb, p) >= 0
                and orient2d(pb, pc, p) >= 0
                and orient2d(pc, pa, p) >= 0
            ):
                return tid
        raise RuntimeError("point location failed: point outside mesh")

    # ------------------------------------------------------------------ #
    # vertex insertion (split + Lawson legalization)
    # ------------------------------------------------------------------ #
    def insert_point(self, p):
        key = (float(p[0]), float(p[1]))
        if key in self._pid and self._pid[key] not in self.super_vertices:
            vid = self._pid[key]
            rec = InsertionRecord(self.points[vid], vid)
            return vid, rec  # duplicate point, nothing to do
        vid = self.add_point(p)
        self._ensure()
        tid = self.locate(self.points[vid])
        rec = InsertionRecord(self.points[vid], vid)
        a, b, c = self.triangles[tid]
        pa, pb, pc = self.points[a], self.points[b], self.points[c]
        pt = self.points[vid]
        # on-edge insertion splits the two adjacent triangles into four
        on_edge = -1
        for e, (u, v) in enumerate(((b, c), (c, a), (a, b))):
            if orient2d(self.points[u], self.points[v], pt) == 0:
                on_edge = e
                break
        rec.cavity.append((a, b, c))
        stack = []
        if on_edge < 0:
            self._drop_triangle(tid)
            t0 = self._new_triangle(a, b, vid)
            t1 = self._new_triangle(b, c, vid)
            t2 = self._new_triangle(c, a, vid)
            stack += [(t0, 2), (t1, 2), (t2, 2)]
        else:
            u, v = ((b, c), (c, a), (a, b))[on_edge]
            w = (a, b, c)[on_edge]
            nbr = self._adj[tid][on_edge]
            rec.cavity.append(self.triangles[nbr])
            # neighbor stores directed edge (v, u); find its opposite vertex
            na, nb, nc = self.triangles[nbr]
            wd = {na, nb, nc} - {u, v}
            w2 = wd.pop()
            self._drop_triangle(tid)
            self._drop_triangle(nbr)
            t0 = self._new_triangle(u, vid, w)
            t1 = self._new_triangle(vid, v, w)
            t2 = self._new_triangle(v, vid, w2)
            t3 = self._new_triangle(vid, u, w2)
            stack += [(t0, 1), (t1, 0), (t2, 1), (t3, 0)]
        self._legalize(vid, stack, rec)
        rec.new_triangles = [
            tri for tri in self.triangles.values() if vid in tri
        ]
        for tri in rec.new_triangles:
            cc = circumcircle(*(self.points[v] for v in tri))
            if cc is not None:
                rec.circumcircles.append(cc)
        return vid, rec

    def _legalize(self, vid, stack, rec):
        self._ensure()
        while stack:
            tid, edge = stack.pop()
            if tid not in self.triangles:
                continue
            tri = self.triangles[tid]
            if tri[edge] == vid:
                # edge opposite the new vertex is (v1, v2)
                u, v = tri[(edge + 1) % 3], tri[(edge + 2) % 3]
            elif tri[(edge + 1) % 3] == vid or tri[(edge + 2) % 3] == vid:
                # recompute: find slot where vid sits
                edge = tri.index(vid)
                u, v = tri[(edge + 1) % 3], tri[(edge + 2) % 3]
            else:
                continue
            if frozenset((u, v)) in self.constrained:
                continue
            self._ensure()
            nbr = self._adj[tid][edge]
            if nbr is None:
                continue
            ntri = self.triangles[nbr]
            w = ({ntri[0], ntri[1], ntri[2]} - {u, v}).pop()
            if w in self.super_vertices and vid in self.super_vertices:
                continue
            pa, pb, pc = (self.points[t] for t in tri)
            if incircle(pa, pb, pc, self.points[w]) > 0:
                self._flip(tid, edge, rec)
                # re-examine the two new outer edges
                for t2 in (tid, nbr):
                    if t2 in self.triangles and vid in self.triangles[t2]:
                        stack.append((t2, self.triangles[t2].index(vid)))

    def _flip(self, tid, edge, rec=None):
        self._ensure()
        tri = self.triangles[tid]
        c = tri[edge]
        a = tri[(edge + 1) % 3]
        b = tri[(edge + 2) % 3]
        nbr = self._adj[tid][edge]
        ntri = self.triangles[nbr]
        d = ({ntri[0], ntri[1], ntri[2]} - {a, b}).pop()
        if rec is not None:
            rec.cavity.append(tri)
            rec.cavity.append(ntri)
            rec.flips.append(((a, b), (c, d)))
        self.triangles[tid] = (c, a, d)
        self.triangles[nbr] = (c, d, b)
        self._dirty = True

    # ------------------------------------------------------------------ #
    # constraint edge insertion (cavity retriangulation)
    # ------------------------------------------------------------------ #
    def insert_constraint(self, va, vb, rec=None):
        """Insert a constraint edge between two existing vertices.

        Triangles crossed by the segment are removed, the two resulting
        polygonal chains are retriangulated, and the region is re-legalized
        with edge flips.  Returns a ConstraintRecord for visualization.
        """
        if rec is None:
            rec = ConstraintRecord(va, vb)
        key = frozenset((va, vb))
        if key in self.constrained:
            return rec
        self._ensure()
        pa, pb = self.points[va], self.points[vb]
        # if the edge already exists in the mesh, just mark it constrained
        for t in self._vtx_tris[va]:
            if vb in self.triangles[t]:
                self.constrained.add(key)
                return rec
        # pick the start triangle: the one incident to va whose interior
        # the ray va->vb actually enters; detect a vertex lying exactly
        # on the segment and split the constraint there instead
        start = None
        for t in self._vtx_tris[va]:
            others = [w for w in self.triangles[t] if w != va]
            u, v = others
            pu, pv = self.points[u], self.points[v]
            for w in (u, v):
                if (orient2d(pa, self.points[w], pb) == 0
                        and _between(pa, pb, self.points[w])):
                    self.insert_constraint(va, w, rec)
                    self.insert_constraint(w, vb, rec)
                    return rec
            # pb inside the wedge of the triangle at va?
            if (orient2d(pa, pu, pb) * orient2d(pa, pu, pv) > 0
                    and orient2d(pa, pv, pb) * orient2d(pa, pv, pu) > 0):
                start = t
                break
        if start is None:
            raise RuntimeError("constraint walk: no start triangle")
        # walk from va to vb collecting crossed edges / visited triangles
        visited = []
        crossed = []
        tid = start
        guard = 0
        while vb not in self.triangles[tid]:
            guard += 1
            if guard > 4 * len(self.triangles) + 10:
                raise RuntimeError("constraint walk did not terminate")
            visited.append(tid)
            tri = self.triangles[tid]
            # does the segment pass exactly through a vertex? then split
            split_at = None
            for w in tri:
                if w in (va, vb):
                    continue
                pw = self.points[w]
                if orient2d(pa, pb, pw) == 0 and _between(pa, pb, pw):
                    split_at = w
                    break
            if split_at is not None:
                self.insert_constraint(va, split_at, rec)
                self.insert_constraint(split_at, vb, rec)
                return rec
            hit = None
            for e in range(3):
                u, v = tri[(e + 1) % 3], tri[(e + 2) % 3]
                if crossed and frozenset((u, v)) == crossed[-1]:
                    continue  # do not bounce back through the entry edge
                pu, pv = self.points[u], self.points[v]
                if (
                    orient2d(pa, pb, pu) * orient2d(pa, pb, pv) < 0
                    and orient2d(pu, pv, pa) * orient2d(pu, pv, pb) < 0
                ):
                    hit = e
                    crossed.append(frozenset((u, v)))
                    rec.crossed_edges.append((u, v))
                    break
            if hit is None:
                raise RuntimeError("constraint walk stuck: no exit edge")
            tid = self._adj[tid][hit]
        visited.append(tid)
        rec.cavity = [self.triangles[t] for t in visited]
        # cavity boundary = edges used by exactly one removed triangle
        count = {}
        for t in visited:
            a, b, c = self.triangles[t]
            for e in ((a, b), (b, c), (c, a)):
                k = frozenset(e)
                count[k] = count.get(k, 0) + 1
        boundary = [tuple(e) for e, n in count.items() if n == 1]
        chain1, chain2 = _split_chains(boundary, va, vb)
        for t in visited:
            self._drop_triangle(t)
        new_tids = []
        for chain in (chain1, chain2):
            self._triangulate_chain(chain, new_tids, rec)
        self.constrained.add(key)
        self._legalize_region(new_tids, rec)
        self._ensure()
        rec.new_triangles = [
            self.triangles[t] for t in new_tids if t in self.triangles
        ]
        return rec

    def _triangulate_chain(self, chain, new_tids, rec):
        """Recursively triangulate the polygon bounded by `chain` (ordered
        vertex ids from one segment endpoint to the other) and the closing
        segment.  Emits only non-degenerate CCW triangles."""
        if len(chain) < 3:
            return
        a, b = chain[0], chain[-1]
        pa, pb = self.points[a], self.points[b]
        c = chain[1]
        for v in chain[2:-1]:
            if _strictly_in_triangle(
                pa, self.points[c], pb, self.points[v]
            ):
                c = v
        ci = chain.index(c)
        pc = self.points[c]
        o = orient2d(pa, pc, pb)
        if o > 0:
            new_tids.append(self._new_triangle(a, c, b))
        elif o < 0:
            new_tids.append(self._new_triangle(a, b, c))
        # else: degenerate (collinear) - skip, covered by the two subchains
        self._triangulate_chain(chain[: ci + 1], new_tids, rec)
        self._triangulate_chain(chain[ci:], new_tids, rec)

    def _legalize_region(self, tids, rec):
        stack = [(t, e) for t in tids for e in range(3)]
        self._ensure()
        while stack:
            tid, e = stack.pop()
            if tid not in self.triangles:
                continue
            tri = self.triangles[tid]
            u, v = tri[(e + 1) % 3], tri[(e + 2) % 3]
            if frozenset((u, v)) in self.constrained:
                continue
            nbr = self._adj[tid][e]
            if nbr is None:
                continue
            ntri = self.triangles[nbr]
            w = ({ntri[0], ntri[1], ntri[2]} - {u, v}).pop()
            c = tri[e]
            pc, pd = self.points[c], self.points[w]
            pu, pv = self.points[u], self.points[v]
            # flip only if the quad is convex (new diagonal lies inside)
            if orient2d(pc, pd, pu) * orient2d(pc, pd, pv) >= 0:
                continue
            if incircle(self.points[tri[0]], self.points[tri[1]],
                        self.points[tri[2]], pd) > 0:
                self._flip(tid, e, rec)
                for t2 in (tid, nbr):
                    for e2 in range(3):
                        stack.append((t2, e2))

    # ------------------------------------------------------------------ #
    # exterior / hole removal
    # ------------------------------------------------------------------ #
    def remove_exterior(self, outer, holes):
        from .geometry import point_in_polygon

        kept = {}
        for tid, tri in self.triangles.items():
            if any(v in self.super_vertices for v in tri):
                continue
            cx = sum(self.points[v][0] for v in tri) / 3.0
            cy = sum(self.points[v][1] for v in tri) / 3.0
            if point_in_polygon((cx, cy), outer) != 1:
                continue
            if any(point_in_polygon((cx, cy), h) != -1 for h in holes):
                continue
            kept[tid] = tri
        self.triangles = kept
        self._dirty = True

    # ------------------------------------------------------------------ #
    # queries / export
    # ------------------------------------------------------------------ #
    def edges(self):
        seen = set()
        for a, b, c in self.triangles.values():
            for e in ((a, b), (b, c), (c, a)):
                seen.add(frozenset(e))
        return [tuple(sorted(e)) for e in seen]

    def has_edge(self, u, v):
        key = frozenset((u, v))
        for a, b, c in self.triangles.values():
            for e in ((a, b), (b, c), (c, a)):
                if frozenset(e) == key:
                    return True
        return False

    def export(self):
        """Return (points, triangles) with triangles as CCW index triples."""
        return list(self.points), list(self.triangles.values())
