// 相机：透视 / 正交两种模式，输出 view 与 projection 矩阵

import { lookAt, ortho, perspective } from './math.js';

export class Camera {
  constructor({
    eye = [0, 0, 12],
    target = [0, 0, 0],
    up = [0, 1, 0],
    fovY = Math.PI / 4,
    orthoHeight = 10,
    near = 0.5,
    far = 100,
    mode = 'perspective',
  } = {}) {
    this.eye = eye;
    this.target = target;
    this.up = up;
    this.fovY = fovY;
    this.orthoHeight = orthoHeight;
    this.near = near;
    this.far = far;
    this.mode = mode;
  }

  viewMatrix() {
    return lookAt(this.eye, this.target, this.up);
  }

  projectionMatrix(width, height) {
    const aspect = width / height;
    if (this.mode === 'ortho') {
      const h = this.orthoHeight / 2;
      const w = h * aspect;
      return ortho(-w, w, -h, h, this.near, this.far);
    }
    return perspective(this.fovY, aspect, this.near, this.far);
  }
}
