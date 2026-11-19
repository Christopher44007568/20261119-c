(function (global) {
  "use strict";

  const OUTER = [
    [0.08, 0.27], [0.18, 0.105], [0.45, 0.055], [0.70, 0.09],
    [0.90, 0.255], [0.94, 0.52], [0.85, 0.78], [0.69, 0.92],
    [0.40, 0.945], [0.17, 0.81], [0.06, 0.56]
  ].map(function (p) { return { x: p[0], y: p[1] }; });

  const HOLE = [
    [0.625, 0.495], [0.535, 0.635], [0.405, 0.625],
    [0.345, 0.485], [0.43, 0.355], [0.565, 0.365]
  ].map(function (p) { return { x: p[0], y: p[1] }; });

  const HANDLES = [
    { id: "A", name: "left lobe", x: 0.155, y: 0.465, color: "#db7142" },
    { id: "B", name: "upper right", x: 0.805, y: 0.255, color: "#4e8fbe" },
    { id: "C", name: "lower right", x: 0.755, y: 0.795, color: "#8e74b2" },
    { id: "D", name: "near-void", x: 0.705, y: 0.495, color: "#3e9b7d" }
  ];

  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersects = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pointInDomain(x, y) {
    return pointInPolygon(x, y, OUTER) && !pointInPolygon(x, y, HOLE);
  }

  function buildGrid(cols, rows) {
    const size = cols * rows;
    const xs = new Float32Array(size);
    const ys = new Float32Array(size);
    const valid = new Uint8Array(size);
    const gridToActive = new Int32Array(size);
    const activeToGrid = [];
    gridToActive.fill(-1);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const gi = row * cols + col;
        const x = (col + 0.5) / cols;
        const y = (row + 0.5) / rows;
        xs[gi] = x;
        ys[gi] = y;
        if (pointInDomain(x, y)) {
          valid[gi] = 1;
          gridToActive[gi] = activeToGrid.length;
          activeToGrid.push(gi);
        }
      }
    }

    const activeToGridArray = Int32Array.from(activeToGrid);
    const neighbors = new Array(activeToGridArray.length);
    const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (let ai = 0; ai < activeToGridArray.length; ai++) {
      const gi = activeToGridArray[ai];
      const col = gi % cols;
      const row = (gi / cols) | 0;
      const list = [];
      for (let k = 0; k < offsets.length; k++) {
        const c = col + offsets[k][0];
        const r = row + offsets[k][1];
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        const nai = gridToActive[r * cols + c];
        if (nai >= 0) list.push(nai);
      }
      neighbors[ai] = Int32Array.from(list);
    }

    return {
      cols: cols,
      rows: rows,
      size: size,
      xs: xs,
      ys: ys,
      valid: valid,
      activeToGrid: activeToGridArray,
      gridToActive: gridToActive,
      neighbors: neighbors,
      count: activeToGridArray.length
    };
  }

  function nearestActive(grid, x, y) {
    let best = -1;
    let bestDist = Infinity;
    for (let ai = 0; ai < grid.count; ai++) {
      const gi = grid.activeToGrid[ai];
      const dx = grid.xs[gi] - x;
      const dy = grid.ys[gi] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = ai;
      }
    }
    return { active: best, distance: Math.sqrt(bestDist) };
  }

  function graphDistances(grid, source) {
    const dist = new Float32Array(grid.count);
    dist.fill(Infinity);
    const queue = new Int32Array(grid.count);
    let head = 0;
    let tail = 0;
    dist[source] = 0;
    queue[tail++] = source;
    while (head < tail) {
      const current = queue[head++];
      const nextDist = dist[current] + 1;
      const adjacent = grid.neighbors[current];
      for (let i = 0; i < adjacent.length; i++) {
        const next = adjacent[i];
        if (nextDist < dist[next]) {
          dist[next] = nextDist;
          queue[tail++] = next;
        }
      }
    }
    return dist;
  }

  function connectedComponents(grid) {
    const seen = new Uint8Array(grid.count);
    let components = 0;
    for (let start = 0; start < grid.count; start++) {
      if (seen[start]) continue;
      components++;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const ai = stack.pop();
        const adjacent = grid.neighbors[ai];
        for (let k = 0; k < adjacent.length; k++) {
          if (!seen[adjacent[k]]) {
            seen[adjacent[k]] = 1;
            stack.push(adjacent[k]);
          }
        }
      }
    }
    return components;
  }

  function laplacian(field, grid, out) {
    for (let ai = 0; ai < grid.count; ai++) {
      const adjacent = grid.neighbors[ai];
      let sum = 0;
      for (let k = 0; k < adjacent.length; k++) sum += field[adjacent[k]];
      out[ai] = adjacent.length ? sum / adjacent.length - field[ai] : 0;
    }
    return out;
  }

  function biharmonicStep(field, grid, scratchA, scratchB, out) {
    laplacian(field, grid, scratchA);
    return laplacian(scratchA, grid, out);
  }

  function projectFields(fields, grid, handleNodes, seedFields) {
    const handleAt = new Int32Array(grid.count);
    handleAt.fill(-1);
    for (let k = 0; k < handleNodes.length; k++) handleAt[handleNodes[k]] = k;

    for (let ai = 0; ai < grid.count; ai++) {
      const locked = handleAt[ai];
      if (locked >= 0) {
        for (let k = 0; k < fields.length; k++) {
          fields[k][ai] = k === locked ? 1 : 0;
        }
        continue;
      }

      let sum = 0;
      for (let k = 0; k < fields.length; k++) {
        let value = fields[k][ai];
        if (!Number.isFinite(value)) value = seedFields[k][ai];
        value = Math.max(0, Math.min(1, value));
        fields[k][ai] = value;
        sum += value;
      }

      if (sum < 1e-7) {
        for (let k = 0; k < fields.length; k++) fields[k][ai] = seedFields[k][ai];
        continue;
      }

      const inverse = 1 / sum;
      let assigned = 0;
      for (let k = 0; k < fields.length - 1; k++) {
        const value = Math.min(1, Math.max(0, fields[k][ai] * inverse));
        fields[k][ai] = value;
        assigned += value;
      }
      fields[fields.length - 1][ai] = Math.max(0, 1 - assigned);
    }
  }

  function makeSeedFields(grid, handleNodes) {
    const count = handleNodes.length;
    const distances = [];
    let farthest = 1;
    for (let k = 0; k < count; k++) {
      const distance = graphDistances(grid, handleNodes[k]);
      distances.push(distance);
      for (let ai = 0; ai < grid.count; ai++) {
        if (distance[ai] > farthest) farthest = distance[ai];
      }
    }

    const sigma = Math.max(4, Math.min(grid.cols, grid.rows) * 0.26);
    const weights = [];
    for (let ai = 0; ai < grid.count; ai++) {
      let sum = 0;
      const local = new Float32Array(count);
      for (let k = 0; k < count; k++) {
        const d = distances[k][ai];
        const value = Number.isFinite(d) ? Math.exp(-Math.pow(d / sigma, 1.7)) : 0;
        local[k] = value;
        sum += value;
      }
      if (sum < 1e-12) {
        let nearest = 0;
        for (let k = 1; k < count; k++) {
          if (distances[k][ai] < distances[nearest][ai]) nearest = k;
        }
        local[nearest] = 1;
        sum = 1;
      }
      for (let k = 0; k < count; k++) {
        if (!weights[k]) weights[k] = new Float32Array(grid.count);
        weights[k][ai] = local[k] / sum;
      }
    }
    return weights;
  }

  function directBiharmonicAt(field, grid, ai) {
    const gi = grid.activeToGrid[ai];
    const col = gi % grid.cols;
    const row = (gi / grid.cols) | 0;
    const center = field[ai];
    const offsets = [
      [-1, 0, -8], [1, 0, -8], [0, -1, -8], [0, 1, -8],
      [-1, -1, 2], [1, -1, 2], [-1, 1, 2], [1, 1, 2],
      [-2, 0, 1], [2, 0, 1], [0, -2, 1], [0, 2, 1]
    ];
    let centerWeight = 20;
    let value = 0;
    for (let k = 0; k < offsets.length; k++) {
      const c = col + offsets[k][0];
      const r = row + offsets[k][1];
      if (c < 0 || c >= grid.cols || r < 0 || r >= grid.rows) {
        centerWeight += offsets[k][2];
        continue;
      }
      const nai = grid.gridToActive[r * grid.cols + c];
      if (nai < 0) {
        centerWeight += offsets[k][2];
      } else {
        value += offsets[k][2] * field[nai];
      }
    }
    return value + centerWeight * center;
  }

  function rms(values) {
    if (!values.length) return 0;
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[i] * values[i];
    return Math.sqrt(sum / values.length);
  }

  function computeMetrics(fields, grid, handleNodes, handleOffsets) {
    let minValue = Infinity;
    let maxValue = -Infinity;
    let sumError = 0;
    let dirichletError = 0;
    let activeLocks = 0;

    for (let ai = 0; ai < grid.count; ai++) {
      let sum = 0;
      for (let k = 0; k < fields.length; k++) {
        const value = fields[k][ai];
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
        sum += value;
        if (value <= 1e-6 || value >= 1 - 1e-6) activeLocks++;
      }
      sumError = Math.max(sumError, Math.abs(sum - 1));
    }

    for (let j = 0; j < handleNodes.length; j++) {
      for (let k = 0; k < fields.length; k++) {
        const expected = j === k ? 1 : 0;
        dirichletError = Math.max(dirichletError, Math.abs(fields[k][handleNodes[j]] - expected));
      }
    }

    const scratchA = new Float32Array(grid.count);
    const scratchB = new Float32Array(grid.count);
    let pdeSquared = 0;
    let pdeScale = 0;
    let kktSquared = 0;
    let kktScale = 0;
    let samples = 0;
    const step = 0.115;
    const trialFields = fields.map(function (field) {
      return Float32Array.from(field);
    });

    for (let k = 0; k < fields.length; k++) {
      const field = fields[k];
      for (let ai = 0; ai < grid.count; ai++) {
        if (handleOffsets.indexOf(ai) >= 0) continue;
        const residual = directBiharmonicAt(field, grid, ai);
        pdeSquared += residual * residual;
        pdeScale += 400 * field[ai] * field[ai];
        samples++;
      }
      biharmonicStep(field, grid, scratchA, scratchB, scratchB);
      for (let ai = 0; ai < grid.count; ai++) {
        trialFields[k][ai] = field[ai] - step * scratchB[ai];
      }
    }

    projectFields(trialFields, grid, handleOffsets, fields);
    for (let k = 0; k < fields.length; k++) {
      for (let ai = 0; ai < grid.count; ai++) {
        if (handleOffsets.indexOf(ai) >= 0) continue;
        const projectedStep = (fields[k][ai] - trialFields[k][ai]) / step;
        kktSquared += projectedStep * projectedStep;
        kktScale += fields[k][ai] * fields[k][ai];
      }
    }

    const pdeResidual = Math.sqrt(pdeSquared / Math.max(1, samples)) /
      Math.sqrt(pdeScale / Math.max(1, samples));
    const kktResidual = Math.sqrt(kktSquared / Math.max(1, samples)) /
      Math.sqrt(kktScale / Math.max(1, samples));

    return {
      min: minValue,
      max: maxValue,
      sumError: sumError,
      dirichletError: dirichletError,
      boundError: Math.max(0, -minValue, maxValue - 1),
      activeLocks: activeLocks,
      pdeResidual: pdeResidual,
      kktResidual: kktResidual
    };
  }

  function solveWeights(options) {
    const started = performance.now();
    const cols = options.cols || 52;
    const rows = options.rows || 38;
    const iterations = options.iterations || 220;
    const handles = options.handles || HANDLES;
    const grid = buildGrid(cols, rows);
    const handleSnaps = handles.map(function (handle) {
      return nearestActive(grid, handle.x, handle.y);
    });
    const handleNodes = handleSnaps.map(function (snap) { return snap.active; });
    const uniqueHandles = new Set(handleNodes);
    const components = connectedComponents(grid);
    const handlesInside = handles.every(function (handle) {
      return pointInDomain(handle.x, handle.y);
    });
    const feasible = handlesInside && uniqueHandles.size === handles.length && grid.count > 0;

    if (!feasible) {
      return {
        grid: grid,
        handles: handles,
        fields: [],
        handleNodes: handleNodes,
        handleSnaps: handleSnaps,
        feasible: false,
        components: components,
        handlesInside: handlesInside,
        metrics: null,
        iterations: 0,
        solveTime: performance.now() - started
      };
    }

    const seedFields = makeSeedFields(grid, handleNodes);
    const fields = seedFields.map(function (field) {
      return Float32Array.from(field);
    });
    const scratchA = new Float32Array(grid.count);
    const scratchB = new Float32Array(grid.count);
    projectFields(fields, grid, handleNodes, seedFields);

    const step = 0.115;
    for (let iteration = 0; iteration < iterations; iteration++) {
      for (let k = 0; k < fields.length; k++) {
        biharmonicStep(fields[k], grid, scratchA, scratchB, scratchB);
        for (let ai = 0; ai < grid.count; ai++) {
          fields[k][ai] -= step * scratchB[ai];
        }
      }
      projectFields(fields, grid, handleNodes, seedFields);
    }

    const metrics = computeMetrics(fields, grid, handleNodes, handleNodes);
    return {
      grid: grid,
      handles: handles,
      fields: fields,
      seedFields: seedFields,
      handleNodes: handleNodes,
      handleSnaps: handleSnaps,
      feasible: feasible,
      components: components,
      handlesInside: handlesInside,
      metrics: metrics,
      iterations: iterations,
      solveTime: performance.now() - started
    };
  }

  global.BiharmonicCore = {
    OUTER: OUTER,
    HOLE: HOLE,
    HANDLES: HANDLES,
    pointInPolygon: pointInPolygon,
    pointInDomain: pointInDomain,
    buildGrid: buildGrid,
    nearestActive: nearestActive,
    graphDistances: graphDistances,
    connectedComponents: connectedComponents,
    laplacian: laplacian,
    directBiharmonicAt: directBiharmonicAt,
    makeSeedFields: makeSeedFields,
    computeMetrics: computeMetrics,
    solveWeights: solveWeights
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.BiharmonicCore;
  }
})(typeof window !== "undefined" ? window : globalThis);
