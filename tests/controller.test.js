import assert from 'node:assert/strict';
import { test } from 'node:test';
import { solveFold } from '../src/core/folding.js';
import { degreeFourLoop, degreesState } from '../src/core/patterns.js';

// Mirrors the accept/reject + last-valid-pose policy implemented in app.js,
// exercised without a browser/WebGL environment.
function makeController(pattern) {
  let state = Object.fromEntries(pattern.folds.map((f) => [f.id, 0]));
  let lastAccepted = solveFold(pattern, state);
  return {
    setState(next) {
      state = next;
      const candidate = solveFold(pattern, state);
      if (candidate.accepted) lastAccepted = candidate;
      return { candidate, displayed: lastAccepted, rejected: !candidate.accepted };
    },
    get displayed() {
      return lastAccepted;
    },
  };
}

test('rejected closure state keeps the previous valid pose', () => {
  const pattern = degreeFourLoop();
  const controller = makeController(pattern);
  const valid = controller.setState(degreesState(pattern, { F0: 30, F2: 30 }));
  assert.equal(valid.rejected, false);
  const validPose = controller.displayed;

  const invalid = controller.setState(
    degreesState(pattern, { F0: 60, F1: 20, F2: 60, F3: 30 }),
  );
  assert.equal(invalid.rejected, true);
  assert.equal(controller.displayed, validPose);
  assert.notEqual(invalid.candidate, validPose);
});

test('accepted states update the displayed pose', () => {
  const pattern = degreeFourLoop();
  const controller = makeController(pattern);
  const first = controller.setState(degreesState(pattern, { F0: 20, F2: 20 }));
  assert.equal(first.rejected, false);
  const second = controller.setState(degreesState(pattern, { F0: 50, F2: 50 }));
  assert.equal(second.rejected, false);
  assert.equal(controller.displayed, second.candidate);
});
