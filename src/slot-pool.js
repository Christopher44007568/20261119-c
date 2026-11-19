export const OVERFLOW_POLICY = "DROP_NEWEST";

export class SlotPool {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("capacity must be a positive integer");
    }

    this.capacity = capacity;
    this.freeStack = new Uint32Array(capacity);
    this.generations = new Uint32Array(capacity);
    this.active = new Map();
    this.freeCount = 0;
    this.reclaimed = 0;
    this.dropped = 0;
    this.peak = 0;
    this.reset();
  }

  reset() {
    this.active.clear();
    this.freeCount = this.capacity;
    this.reclaimed = 0;
    this.dropped = 0;
    this.peak = 0;

    for (let index = 0; index < this.capacity; index += 1) {
      this.freeStack[index] = this.capacity - 1 - index;
      this.generations[index] = 0;
    }
  }

  spawn(now, lifetime) {
    if (this.freeCount === 0) {
      this.dropped += 1;
      return null;
    }

    const index = this.freeStack[this.freeCount - 1];
    this.freeCount -= 1;

    const generation = (this.generations[index] + 1) >>> 0;
    this.generations[index] = generation;

    const entry = {
      index,
      generation,
      birth: now,
      expiresAt: now + lifetime,
      lifetime,
    };
    this.active.set(index, entry);
    this.peak = Math.max(this.peak, this.active.size);
    return entry;
  }

  expire(now) {
    const expired = [];

    for (const [index, entry] of this.active) {
      if (now < entry.expiresAt) continue;
      this.active.delete(index);
      this.freeStack[this.freeCount] = index;
      this.freeCount += 1;
      this.reclaimed += 1;
      expired.push(index);
    }

    return expired;
  }

  get count() {
    return this.active.size;
  }

  get free() {
    return this.freeCount;
  }

  get isFull() {
    return this.freeCount === 0;
  }

  get overflowPolicy() {
    return OVERFLOW_POLICY;
  }

  getActiveEntries(now, limit = Infinity) {
    const entries = [];
    let maxGeneration = 0;

    for (const entry of this.active.values()) {
      if (entry.generation > maxGeneration) maxGeneration = entry.generation;
      entries.push({
        index: entry.index,
        generation: entry.generation,
        age: Math.max(0, now - entry.birth),
        remaining: Math.max(0, entry.expiresAt - now),
        lifetime: entry.lifetime,
      });
    }

    entries.sort((left, right) => left.index - right.index);

    return {
      entries: entries.slice(0, limit),
      total: entries.length,
      maxGeneration,
    };
  }

  snapshot(now) {
    return {
      capacity: this.capacity,
      active: this.count,
      free: this.free,
      reclaimed: this.reclaimed,
      dropped: this.dropped,
      peak: this.peak,
      policy: OVERFLOW_POLICY,
      activeEntries: this.getActiveEntries(now),
    };
  }
}
