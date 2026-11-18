export const PRESETS = [
  {
    id: "convex",
    label: "凸六边形",
    kicker: "CONVEX",
    description: "所有内角为凸角，波前连续缩小直至消失。",
    targetDistance: 70,
    points: [
      { x: 140, y: 300 },
      { x: 300, y: 120 },
      { x: 600, y: 160 },
      { x: 720, y: 350 },
      { x: 500, y: 520 },
      { x: 220, y: 480 },
    ],
  },
  {
    id: "narrow-neck",
    label: "窄颈凹形",
    kicker: "PINCH",
    description: "颈宽向右收窄，先由凹顶点撞边分裂，再出现分裂与边消失的同刻事件。",
    targetDistance: 65,
    points: [
      { x: 80, y: 100 },
      { x: 280, y: 100 },
      { x: 280, y: 250 },
      { x: 520, y: 250 },
      { x: 520, y: 100 },
      { x: 720, y: 100 },
      { x: 720, y: 500 },
      { x: 520, y: 500 },
      { x: 520, y: 320 },
      { x: 280, y: 350 },
      { x: 280, y: 500 },
      { x: 80, y: 500 },
    ],
  },
  {
    id: "symmetric",
    label: "对称方形",
    kicker: "SYMMETRY",
    description: "四条边和两对顶点在同一时刻到达中心，验证事件合并。",
    targetDistance: 120,
    points: [
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 500 },
      { x: 100, y: 500 },
    ],
  },
];

export const DEFAULT_PRESET = PRESETS[1];
