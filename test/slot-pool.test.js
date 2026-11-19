import test from "node:test";
import assert from "node:assert/strict";
import { OVERFLOW_POLICY, SlotPool } from "../src/slot-pool.js";

test("a full pool rejects new emissions without evicting live slots", () => {
  const pool = new SlotPool(2);
  const first = pool.spawn(0, 4);
  const second = pool.spawn(0, 4);
  const rejected = pool.spawn(0, 4);

  assert.equal(pool.overflowPolicy, OVERFLOW_POLICY);
  assert.equal(pool.count, 2);
  assert.equal(pool.free, 0);
  assert.equal(pool.dropped, 1);
  assert.equal(rejected, null);
  assert.equal(first.index, 0);
  assert.equal(second.index, 1);
});

test("expired slots return to the free stack and keep their generation", () => {
  const pool = new SlotPool(2);
  const first = pool.spawn(0, 1);
  pool.spawn(0, 5);

  assert.deepEqual(pool.expire(1), [0]);
  assert.equal(pool.count, 1);
  assert.equal(pool.reclaimed, 1);
  assert.equal(pool.free, 1);
  assert.equal(pool.generations[first.index], 1);

  const reused = pool.spawn(1.1, 3);
  assert.equal(reused.index, 0);
  assert.equal(reused.generation, 2);
  assert.equal(pool.generations[0], 2);
});

test("active entries expose stable indices, generation, and age", () => {
  const pool = new SlotPool(4);
  pool.spawn(0, 4);
  pool.spawn(0, 8);
  pool.expire(4);
  pool.spawn(4, 8);

  const { entries, total, maxGeneration } = pool.getActiveEntries(5);
  assert.equal(total, 2);
  assert.equal(maxGeneration, 2);
  assert.deepEqual(
    entries.map((entry) => [entry.index, entry.generation, entry.age]),
    [
      [0, 2, 1],
      [1, 1, 5],
    ],
  );
});

test("bursts report every emission rejected after capacity is reached", () => {
  const pool = new SlotPool(8);
  const accepted = [];

  for (let i = 0; i < 12; i += 1) {
    const entry = pool.spawn(0, 5);
    if (entry) accepted.push(entry.index);
  }

  assert.equal(accepted.length, 8);
  assert.equal(pool.dropped, 4);
  assert.equal(pool.count, 8);
  assert.deepEqual([...new Set(accepted)].length, 8);
});
