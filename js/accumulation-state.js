(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AccumulationState = api.AccumulationState;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  class AccumulationState {
    constructor(maxSamples = 1000) {
      this.maxSamples = maxSamples;
      this.samples = 0;
      this.paused = false;
      this.elapsed = 0;
      this.generation = 0;
      this.reason = "initialize";
    }

    reset(reason = "manual") {
      this.samples = 0;
      this.elapsed = 0;
      this.generation += 1;
      this.reason = reason;
    }

    addSample(count = 1) {
      if (this.paused) return this.samples;
      const next = Math.min(this.maxSamples, this.samples + Math.max(0, count));
      this.samples = next;
      return next;
    }

    addElapsed(milliseconds) {
      if (this.paused || this.samples >= this.maxSamples) return this.elapsed;
      this.elapsed += Math.max(0, milliseconds);
      return this.elapsed;
    }

    togglePause() {
      this.paused = !this.paused;
      return this.paused;
    }

    setPaused(value) {
      this.paused = Boolean(value);
      return this.paused;
    }

    get converged() {
      return this.samples >= this.maxSamples;
    }

    get state() {
      if (this.paused) return "paused";
      if (this.converged) return "converged";
      return this.samples === 0 ? "ready" : "accumulating";
    }

    snapshot() {
      return {
        samples: this.samples,
        maxSamples: this.maxSamples,
        paused: this.paused,
        elapsed: this.elapsed,
        generation: this.generation,
        reason: this.reason,
        state: this.state
      };
    }
  }

  return { AccumulationState };
});
