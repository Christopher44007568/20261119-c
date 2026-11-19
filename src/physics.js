export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, -1, 0];
  },
  lerp: (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
};

export const DEFAULTS = {
  segments: 10,
  restLength: 0.36,
  gravity: [0, -9.81, 0],
  linearDamping: 1.6,
  maxBend: 0.86,
  iterations: 8,
  nodeRadius: 0.075,
  collisionFriction: 0.34,
  sphere: { center: [0, 0.15, 0], radius: 1.05 },
  teleportDistance: 0.58,
};

export class SecondaryChain {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.segments = this.options.segments;
    this.restLength = this.options.restLength;
    this.positions = Array.from({ length: this.segments + 1 }, () => [0, 0, 0]);
    this.previous = Array.from({ length: this.segments + 1 }, () => [0, 0, 0]);
    this.velocities = Array.from({ length: this.segments + 1 }, () => [0, 0, 0]);
    this.rootVelocity = [0, 0, 0];
    this.rootTeleported = false;
    this.teleportCount = 0;
    this.collisions = [];
    this.maxLinkError = 0;
    this.lengthError = 0;
    this.lengthErrorRatio = 0;
    this.maxSpeed = 0;
    this.endSpeed = 0;
    this.energy = 0;
    this.solveTime = 0;
    this.reset([0, 1.72, 0], [0, -1, 0]);
  }

  reset(rootPosition, down = [0, -1, 0]) {
    const direction = V.normalize(down);
    for (let index = 0; index <= this.segments; index += 1) {
      this.positions[index] = V.add(rootPosition, V.scale(direction, index * this.restLength));
      this.previous[index] = [...this.positions[index]];
      this.velocities[index] = [0, 0, 0];
    }
    this.rootVelocity = [0, 0, 0];
    this.collisions = [];
  }

  teleportRoot(position, policy = "reset") {
    const oldRoot = this.positions[0];
    const delta = V.sub(position, oldRoot);
    if (policy === "momentum") {
      for (let index = 0; index <= this.segments; index += 1) {
        this.positions[index] = V.add(this.positions[index], delta);
        this.previous[index] = V.add(this.previous[index], delta);
      }
      this.rootVelocity = [0, 0, 0];
    } else {
      this.reset(position, [0, -1, 0]);
    }
    this.rootTeleported = true;
    this.teleportCount += 1;
  }

  driveRoot(position, dt, policy = "reset") {
    const delta = V.sub(position, this.positions[0]);
    const distance = V.len(delta);
    if (distance > this.options.teleportDistance) {
      this.teleportRoot(position, policy);
      return;
    }
    this.rootTeleported = false;
    if (dt > 0) {
      const instantaneous = V.scale(delta, 1 / dt);
      const blend = 1 - Math.exp(-18 * dt);
      this.rootVelocity = V.lerp(this.rootVelocity, instantaneous, blend);
    }
    this.positions[0] = [...position];
    this.previous[0] = [...position];
  }

  step(dt, root, settings = {}) {
    const start = performance.now();
    const iterations = Math.max(1, Math.round(settings.iterations ?? this.options.iterations));
    const policy = settings.teleportPolicy ?? "reset";
    this.driveRoot(root.position, dt, policy);
    this.maxBend = settings.maxBend ?? this.options.maxBend;
    this.restLength = settings.restLength ?? this.options.restLength;
    this.options.sphere = settings.sphere ?? this.options.sphere;

    if (!this.rootTeleported) {
      this.integrate(dt, settings.gravity ?? this.options.gravity);
    }

    this.collisions = [];
    for (let pass = 0; pass < iterations; pass += 1) {
      this.solveDistances();
      this.solveCones();
      this.solveCollisions(dt);
    }
    this.enforceCollisions(dt);
    this.updateVelocity(dt);
    this.measure();
    this.solveTime = performance.now() - start;
    return this;
  }

  integrate(dt, gravity) {
    const damping = Math.exp(-this.options.linearDamping * dt);
    this._integratedVelocities = [];
    this._integratedVelocities[0] = [0, 0, 0];
    for (let index = 1; index <= this.segments; index += 1) {
      const velocity = this.velocities[index];
      velocity[0] += gravity[0] * dt;
      velocity[1] += gravity[1] * dt;
      velocity[2] += gravity[2] * dt;
      velocity[0] *= damping;
      velocity[1] *= damping;
      velocity[2] *= damping;
      this._integratedVelocities[index] = [...velocity];
      this.previous[index] = [...this.positions[index]];
      this.positions[index] = V.add(this.positions[index], V.scale(velocity, dt));
    }
  }

  solveDistances() {
    for (let index = 0; index < this.segments; index += 1) {
      const a = this.positions[index];
      const b = this.positions[index + 1];
      const delta = V.sub(b, a);
      const distance = V.len(delta);
      if (distance < 1e-8) continue;
      const error = (distance - this.restLength) / distance;
      if (index === 0) {
        this.positions[index + 1] = V.sub(b, V.scale(delta, error));
      } else {
        const correction = V.scale(delta, error * 0.5);
        this.positions[index] = V.add(a, correction);
        this.positions[index + 1] = V.sub(b, correction);
      }
    }
  }

  solveCones() {
    const cosineLimit = Math.cos(this.maxBend);
    for (let index = 1; index < this.segments; index += 1) {
      const previous = this.positions[index - 1];
      const joint = this.positions[index];
      const next = this.positions[index + 1];
      const incoming = V.normalize(V.sub(joint, previous));
      const outgoing = V.normalize(V.sub(next, joint));
      const cosine = Math.max(-1, Math.min(1, V.dot(incoming, outgoing)));
      if (cosine >= cosineLimit) continue;
      let perpendicular = V.sub(outgoing, V.scale(incoming, cosine));
      if (V.len(perpendicular) < 1e-6) {
        const axis = Math.abs(incoming[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
        perpendicular = V.normalize(V.cross(incoming, axis));
      } else {
        perpendicular = V.normalize(perpendicular);
      }
      const limited = V.add(
        V.scale(incoming, Math.cos(this.maxBend)),
        V.scale(perpendicular, Math.sin(this.maxBend)),
      );
      this.positions[index + 1] = V.add(joint, V.scale(limited, this.restLength));
    }
  }

  solveCollisions(dt) {
    const { center, radius } = this.options.sphere;
    this.collisions = [];
    for (let index = 1; index <= this.segments; index += 1) {
      const position = this.positions[index];
      const delta = V.sub(position, center);
      const distance = V.len(delta);
      const minimum = radius + this.options.nodeRadius;
      if (distance >= minimum) continue;
      const normal = distance > 1e-7 ? V.scale(delta, 1 / distance) : [0, 1, 0];
      this.positions[index] = V.add(center, V.scale(normal, minimum + 1e-4));
      const velocity = this.velocities[index];
      const inward = V.dot(velocity, normal);
      if (inward < 0) {
        velocity[0] -= normal[0] * inward;
        velocity[1] -= normal[1] * inward;
        velocity[2] -= normal[2] * inward;
      }
      const friction = Math.exp(-this.options.collisionFriction * dt);
      velocity[0] *= friction;
      velocity[1] *= friction;
      velocity[2] *= friction;
      this.collisions.push({
        index,
        point: V.add(center, V.scale(normal, radius)),
        normal,
        normalSpeed: Math.max(0, -inward),
      });
    }
  }

  enforceCollisions(dt) {
    this.solveCollisions(dt);
    const { center, radius } = this.options.sphere;
    const contactBand = radius + this.options.nodeRadius + 0.012;
    for (let index = 1; index <= this.segments; index += 1) {
      const delta = V.sub(this.positions[index], center);
      const distance = V.len(delta);
      if (distance > contactBand) continue;
      const normal = distance > 1e-7 ? V.scale(delta, 1 / distance) : [0, 1, 0];
      if (this.collisions.some((contact) => contact.index === index)) continue;
      this.collisions.push({
        index,
        point: V.add(center, V.scale(normal, radius)),
        normal,
        normalSpeed: 0,
      });
    }
  }

  updateVelocity(dt) {
    if (dt <= 0) return;
    const rootVelocity = V.scale(V.sub(this.positions[0], this.previous[0]), 1 / dt);
    this.rootVelocity = V.lerp(this.rootVelocity, rootVelocity, 0.35);
    if (this.rootTeleported) {
      for (let index = 1; index <= this.segments; index += 1) {
        this.applyContactVelocity(index, dt, 0.02);
      }
      return;
    }
    const speedLimit = Math.max(10, V.len(this.rootVelocity) * 1.8 + 3.5);
    for (let index = 1; index <= this.segments; index += 1) {
      const measured = V.scale(V.sub(this.positions[index], this.previous[index]), 1 / dt);
      const integrated = this._integratedVelocities?.[index] ?? this.velocities[index];
      let velocity = V.lerp(measured, integrated, 0.38);
      const speed = V.len(velocity);
      if (speed > speedLimit) velocity = V.scale(velocity, speedLimit / speed);
      this.velocities[index] = velocity;
      this.applyContactVelocity(index, dt);
    }
  }

  applyContactVelocity(index, dt, margin = 0.008) {
    const { center, radius } = this.options.sphere;
    const delta = V.sub(this.positions[index], center);
    const distance = V.len(delta);
    if (distance > radius + this.options.nodeRadius + margin) return;
    const normal = distance > 1e-7 ? V.scale(delta, 1 / distance) : [0, 1, 0];
    const velocity = this.velocities[index];
    const inward = V.dot(velocity, normal);
    if (inward < 0) {
      velocity[0] -= normal[0] * inward;
      velocity[1] -= normal[1] * inward;
      velocity[2] -= normal[2] * inward;
    }
    const friction = Math.exp(-this.options.collisionFriction * dt);
    velocity[0] *= friction;
    velocity[1] *= friction;
    velocity[2] *= friction;
  }

  measure() {
    let totalError = 0;
    let maxError = 0;
    let maxSpeed = 0;
    let energy = 0;
    for (let index = 0; index < this.segments; index += 1) {
      const distance = V.len(V.sub(this.positions[index + 1], this.positions[index]));
      const error = Math.abs(distance - this.restLength);
      totalError += error;
      maxError = Math.max(maxError, error);
    }
    for (let index = 0; index <= this.segments; index += 1) {
      const speed = V.len(this.velocities[index]);
      maxSpeed = Math.max(maxSpeed, speed);
      energy += 0.5 * speed * speed;
    }
    this.lengthError = totalError;
    this.maxLinkError = maxError;
    this.lengthErrorRatio = totalError / (this.segments * this.restLength);
    this.maxSpeed = maxSpeed;
    this.endSpeed = V.len(this.velocities[this.segments]);
    this.energy = energy;
  }
}
