import { createMesh } from './meshCore.js';

function touchingShells() {
  const positions = [
    [0, -0.95, 0],
    [0, 0.95, 0],
    [1.15, -0.25, -0.55],
    [0.7, 0.35, 0.85],
    [-1.15, -0.25, -0.55],
    [-0.7, 0.35, 0.85],
  ];
  const faces = [
    [0, 1, 2],
    [0, 3, 1],
    [0, 3, 2],
    [1, 3, 2],
    [0, 4, 1],
    [0, 1, 5],
    [0, 5, 4],
    [1, 4, 5],
  ];
  return createMesh(
    '两壳接触',
    positions,
    faces,
    { sample: true, note: '两个闭合四面体共享一条边' },
  );
}

function openSheet() {
  const x = [-1.45, -0.48, 0.48, 1.45];
  const z = [-0.95, 0, 0.95];
  const positions = [];
  z.forEach((zValue) => {
    x.forEach((xValue) => {
      const y =
        0.04 +
        0.2 * Math.cos(xValue * 1.05) +
        0.045 * Math.sin(zValue * 1.8);
      positions.push([xValue, y, zValue]);
    });
  });

  const originalColumnTwo = [2, 6, 10].map((index) => positions[index].slice());
  positions.push(...originalColumnTwo);
  positions.push(
    [1.58, 0.66, 1.3],
    [2.16, 0.35, 1.75],
    [1.28, 0.18, 1.92],
  );

  const faces = [
    [0, 4, 1],
    [1, 4, 5],
    [1, 2, 5],
    [2, 5, 6],
    [4, 8, 5],
    [5, 8, 9],
    [5, 9, 6],
    [6, 9, 10],
    [12, 13, 3],
    [3, 13, 7],
    [13, 14, 7],
    [7, 14, 11],
    [15, 16, 17],
  ];
  return createMesh(
    '开口薄片',
    positions,
    faces,
    { sample: true, note: '裂开的曲面、反向面与孤立三角面' },
  );
}

export const SAMPLES = [
  {
    id: 'shells',
    label: '两壳接触',
    eyebrow: 'CASE 01 / SHARED EDGE',
    description: '两个闭合壳体以一条边接触，边入射面数为 4。',
    mesh: touchingShells,
  },
  {
    id: 'sheet',
    label: '开口薄片',
    eyebrow: 'CASE 02 / OPEN SHEET',
    description: '曲面沿接缝裂开，并带有一个反向面和一个孤立面。',
    mesh: openSheet,
  },
];

export function loadSample(id) {
  const sample = SAMPLES.find((entry) => entry.id === id) || SAMPLES[0];
  return {
    sample,
    mesh: sample.mesh(),
  };
}
