import test from "node:test";
import assert from "node:assert/strict";
import { SecondaryChain, V } from "../src/physics.js";

function makeChain(overrides = {}) {
  return new SecondaryChain({
    segments: 8,
    restLength: 0.28,
    sphere: { center: [0, 0.1, 0], radius: 0.9 },
    ...overrides,
  });
}

function settle(chain, frames = 180, dt = 1 / 120) {
  const root = { position: [0.75, 1.55, 0.15] };
  for (let frame = 0; frame < frames; frame += 1) {
    chain.step(dt, root, {
      iterations: chain.options.iterations,
      maxBend: chain.options.maxBend,
      teleportPolicy: "reset",
    });
  }
  return chain;
}

test("distance and cone constraints converge without exploding", () => {
  const chain = settle(makeChain(), 240);
  assert.ok(Number.isFinite(chain.lengthError));
  assert.ok(chain.lengthErrorRatio < 0.012, `length error ratio ${chain.lengthErrorRatio}`);
  assert.ok(chain.maxSpeed < 20, `unexpected speed ${chain.maxSpeed}`);
});

test("chain nodes remain outside the spherical body", () => {
  const chain = makeChain({ segments: 12, restLength: 0.25, iterations: 1 });
  const root = { position: [0.4, 1.65, 0] };
  let collisionFrames = 0;
  for (let frame = 0; frame < 300; frame += 1) {
    chain.step(1 / 120, root, { iterations: 1, maxBend: 1.05 });
    collisionFrames += chain.collisions.length > 0 ? 1 : 0;
    for (const position of chain.positions) {
      const distance = V.len(V.sub(position, chain.options.sphere.center));
      assert.ok(distance >= chain.options.sphere.radius - 1e-3, `node penetrated: ${distance}`);
    }
  }
  assert.ok(collisionFrames > 0);
});

test("reset teleport clears velocity and keeps the root exact", () => {
  const chain = makeChain();
  settle(chain, 90);
  const destination = [-0.75, 1.5, -0.2];
  chain.teleportRoot(destination, "reset");
  assert.deepEqual(chain.positions[0], destination);
  assert.equal(V.len(chain.velocities[1]), 0);
  assert.ok(chain.teleportCount >= 1);
});

test("momentum teleport translates the chain and preserves velocities", () => {
  const chain = makeChain();
  settle(chain, 120);
  const beforeVelocity = [...chain.velocities[3]];
  const beforeSegment = V.sub(chain.positions[2], chain.positions[1]);
  const destination = [-0.8, 1.62, -0.1];
  const oldRoot = [...chain.positions[0]];
  chain.teleportRoot(destination, "momentum");
  assert.deepEqual(chain.positions[0], destination);
  assert.deepEqual(chain.velocities[3], beforeVelocity);
  const afterSegment = V.sub(chain.positions[2], chain.positions[1]);
  assert.ok(V.len(V.sub(afterSegment, beforeSegment)) < 1e-9);
  assert.ok(V.len(V.sub(chain.positions[0], oldRoot)) > 0);
});

test("energy decays to rest after a sudden root stop", () => {
  const chain = makeChain({ linearDamping: 2.4, maxBend: 1.1 });
  const movingRoot = { position: [0.95, 1.58, 0.1] };
  for (let frame = 0; frame < 150; frame += 1) {
    const angle = frame * 0.055;
    movingRoot.position = [Math.cos(angle) * 0.9, 1.58, Math.sin(angle) * 0.9];
    chain.step(1 / 120, movingRoot, { iterations: 10, maxBend: 1.1 });
  }
  const stoppedAt = V.len(chain.velocities[4]);
  const stoppedRoot = { position: [...movingRoot.position] };
  let samples = [];
  for (let frame = 0; frame < 480; frame += 1) {
    chain.step(1 / 120, stoppedRoot, { iterations: 10, maxBend: 1.1 });
    if (frame % 40 === 0) samples.push(chain.energy);
  }
  assert.ok(stoppedAt > 0.01);
  assert.ok(samples.at(-1) < samples[0] * 0.08, `energy ${samples[0]} -> ${samples.at(-1)}`);
  assert.ok(chain.energy < 0.12, `residual energy ${chain.energy}`);
});

test("continuous rotation stays bounded and finite", () => {
  const chain = makeChain({ linearDamping: 1.8 });
  let maxEnergy = 0;
  for (let frame = 0; frame < 900; frame += 1) {
    const angle = frame * 0.05;
    const root = {
      position: [Math.cos(angle) * 1.02, 1.58, Math.sin(angle) * 1.02],
    };
    chain.step(1 / 120, root, { iterations: 8, maxBend: 1.0 });
    maxEnergy = Math.max(maxEnergy, chain.energy);
    assert.ok(chain.positions.every((point) => point.every(Number.isFinite)));
  }
  assert.ok(maxEnergy < 400, `unbounded energy ${maxEnergy}`);
  assert.ok(chain.lengthErrorRatio < 0.03);
  for (const position of chain.positions) {
    const distance = V.len(V.sub(position, chain.options.sphere.center));
    assert.ok(distance >= chain.options.sphere.radius - 1e-3);
  }
});

test("timestep can be changed between 60, 120 and 240 Hz", () => {
  const chain = makeChain();
  for (const hz of [60, 120, 240]) {
    const root = { position: [0.6, 1.55, 0] };
    for (let frame = 0; frame < hz; frame += 1) {
      chain.step(1 / hz, root, { iterations: 6, maxBend: 0.9 });
    }
    assert.ok(chain.positions.every((point) => point.every(Number.isFinite)));
    assert.ok(chain.lengthErrorRatio < 0.035);
  }
});
