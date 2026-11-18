// Minimal orbit camera: spherical angles around a target point.

export class OrbitCamera {
  constructor(target = [0, 0, 0], radius = 6) {
    this.target = target;
    this.radius = radius;
    this.azimuth = -Math.PI / 4;
    this.elevation = 0.5;
  }

  get eye() {
    const ce = Math.cos(this.elevation);
    return [
      this.target[0] + this.radius * ce * Math.cos(this.azimuth),
      this.target[1] + this.radius * ce * Math.sin(this.azimuth),
      this.target[2] + this.radius * Math.sin(this.elevation),
    ];
  }

  rotate(dx, dy) {
    this.azimuth -= dx * 0.008;
    this.elevation += dy * 0.008;
    const limit = Math.PI / 2 - 0.02;
    this.elevation = Math.max(-limit, Math.min(limit, this.elevation));
  }

  zoom(factor) {
    this.radius = Math.max(1.2, Math.min(30, this.radius * factor));
  }

  attach(canvas) {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.rotate(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const stop = () => {
      dragging = false;
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(e.deltaY > 0 ? 1.1 : 0.9);
      },
      { passive: false },
    );
  }
}
