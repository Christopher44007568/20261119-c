"use strict";

const assert = require("node:assert/strict");
const { AccumulationState } = require("../js/accumulation-state");

const state = new AccumulationState(1000);
assert.equal(state.samples, 0);
assert.equal(state.state, "ready");

state.addElapsed(250);
state.addSample(10);
assert.equal(state.samples, 10);
assert.equal(state.elapsed, 250);

state.togglePause();
assert.equal(state.paused, true);
state.addSample(1);
state.addElapsed(500);
assert.equal(state.samples, 10, "Pause must not add samples");
assert.equal(state.elapsed, 250, "Pause must not advance elapsed accumulation time");

const generation = state.generation;
state.reset("camera");
assert.equal(state.samples, 0, "Camera change must clear the sample count");
assert.equal(state.generation, generation + 1);
assert.equal(state.paused, true, "Camera reset must not resume a paused renderer");
state.addSample(1);
assert.equal(state.samples, 0, "A paused camera reset must remain paused");

state.togglePause();
state.addSample(1);
assert.equal(state.samples, 1, "Resume must continue from zero without another reset");

state.reset("restart");
state.addSample(1200);
assert.equal(state.samples, 1000, "Accumulation must stop at the configured target");
assert.equal(state.state, "converged");

console.log("Accumulation state: camera reset and pause semantics verified.");
