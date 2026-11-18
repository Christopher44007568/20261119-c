// Built-in crease patterns. Coordinates lie in the z = 0 plane; assignments
// are 'M' (mountain) or 'V' (valley). Fold state values are radians, 0 = flat.

// Four-hinge strip: 5 rectangular panels joined by 4 parallel hinges.
// The panel adjacency graph is a simple path, so there are no loop constraints
// and any fold amounts are kinematically admissible (modulo self-contact).
export function fourFoldStrip() {
  const vertices = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
    [5, 1],
  ];
  const panels = [];
  for (let i = 0; i < 5; i++) {
    panels.push({ id: `P${i}`, vertices: [i, i + 1, i + 7, i + 6] });
  }
  const folds = [];
  const assignments = ['V', 'M', 'V', 'M'];
  for (let i = 0; i < 4; i++) {
    folds.push({
      id: `F${i}`,
      panels: [`P${i}`, `P${i + 1}`],
      edge: [i + 1, i + 7],
      assignment: assignments[i],
    });
  }
  return { name: '四折带（无环路径图）', vertices, panels, folds };
}

// Four creases meeting at one interior vertex O, forming a closed ring of four
// panels. The fold closing the ring is F3; its two shared vertices must remain
// coincident and its dihedral angle must match the driven angle, otherwise the
// state is rejected.
export function degreeFourLoop() {
  const vertices = [
    [0, 0], // 0: A (west)
    [1, 0], // 1: O (center)
    [2, 0], // 2: B (east)
    [1, -1], // 3: C (south)
    [1, 1], // 4: D (north)
    [0, -1], // 5: SW
    [2, -1], // 6: SE
    [2, 1], // 7: NE
    [0, 1], // 8: NW
  ];
  const panels = [
    { id: 'P0', vertices: [0, 1, 4, 8] }, // west-north quad
    { id: 'P1', vertices: [1, 2, 7, 4] }, // east-north quad
    { id: 'P2', vertices: [1, 3, 6, 2] }, // east-south quad
    { id: 'P3', vertices: [0, 5, 3, 1] }, // west-south quad
  ];
  const folds = [
    { id: 'F0', panels: ['P0', 'P1'], edge: [1, 4], assignment: 'M' },
    { id: 'F1', panels: ['P1', 'P2'], edge: [1, 2], assignment: 'V' },
    { id: 'F2', panels: ['P2', 'P3'], edge: [1, 3], assignment: 'M' },
    { id: 'F3', panels: ['P3', 'P0'], edge: [0, 1], assignment: 'V' },
  ];
  return { name: '四折汇聚（闭环约束）', vertices, panels, folds };
}

// A fold angle vector in degrees, convenient for tests/demos.
export function degreesState(pattern, degreesByFold) {
  const state = {};
  for (const fold of pattern.folds) {
    state[fold.id] = (degreesByFold[fold.id] ?? 0) * (Math.PI / 180);
  }
  return state;
}
