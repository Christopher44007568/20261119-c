let eventSequence = 0;

export class ResourceLedger {
  constructor() {
    this.events = [];
    this.liveResources = new Set();
  }

  recordAllocation(resource) {
    this.liveResources.add(resource.key);
    this.events.push({
      id: ++eventSequence,
      type: "allocated",
      key: resource.key,
      programId: resource.programId,
      resourceVersion: resource.resourceVersion,
      at: Date.now(),
    });
    return resource.key;
  }

  recordReclaim(resource, reason) {
    this.liveResources.delete(resource.key);
    this.events.push({
      id: ++eventSequence,
      type: "reclaimed",
      key: resource.key,
      programId: resource.programId,
      resourceVersion: resource.resourceVersion,
      reason,
      at: Date.now(),
    });
  }

  reclaimEvents() {
    return this.events.filter((event) => event.type === "reclaimed");
  }

  recent(limit = 20) {
    return this.events.slice(-limit).reverse();
  }

  get liveCount() {
    return this.liveResources.size;
  }
}

export class ManagedShaderBundle {
  constructor({ programId, label, resourceVersion, resource, ledger }) {
    this.programId = programId;
    this.label = label;
    this.resourceVersion = resourceVersion;
    this.resource = resource;
    this.ledger = ledger;
    this.references = 0;
    this.disposed = false;
    this.key = `${programId}@${resourceVersion}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    ledger.recordAllocation(this);
  }

  retain() {
    if (this.disposed) throw new Error(`Resource already disposed: ${this.key}`);
    this.references += 1;
    return this;
  }

  release(reason) {
    this.references = Math.max(0, this.references - 1);
    if (this.references !== 0 || this.disposed) return false;
    this.disposed = true;
    try {
      this.resource?.dispose?.();
    } finally {
      this.ledger.recordReclaim(this, reason);
    }
    return true;
  }
}

export class ProgramSnapshot {
  constructor({ version, programs, dependencies, reason = "superseded" }) {
    this.version = version;
    this.programs = programs;
    this.dependencies = dependencies;
    this.reason = reason;
    this.references = 1;
    this.disposed = false;
    for (const bundle of programs.values()) bundle.retain();
  }

  acquire() {
    if (this.disposed) throw new Error("Cannot acquire a disposed snapshot.");
    this.references += 1;
    return this;
  }

  release(reason = this.reason) {
    this.references = Math.max(0, this.references - 1);
    if (this.references !== 0 || this.disposed) return false;
    this.disposed = true;
    for (const bundle of this.programs.values()) bundle.release(reason);
    return true;
  }
}
