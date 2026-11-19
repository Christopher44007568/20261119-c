import test from "node:test";
import assert from "node:assert/strict";
import {
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import {
  isInsideAperture,
  portalPairTransform,
  poseFromMatrix,
  signedPortalDistance,
} from "../src/portalMath.js";

const EPSILON = 1e-9;

function portalMatrix(position, rotationY) {
  const matrix = new Matrix4().makeRotationY(rotationY);
  matrix.setPosition(position.x, position.y, position.z);
  return matrix;
}

function assertClose(actual, expected, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function assertMatrixClose(actual, expected, epsilon = EPSILON) {
  actual.elements.forEach((value, index) => {
    assertClose(value, expected.elements[index], epsilon);
  });
}

const portalA = portalMatrix(new Vector3(0, 1.7, -8.2), 0);
const portalB = portalMatrix(new Vector3(12.4, 2.1, -1.8), 1.186823891);

test("portal pair maps source front to destination back at equal distance", () => {
  const transform = portalPairTransform(portalA, portalB);
  const sourcePoint = new Vector3(0, 1.7, -8.2 + 4.5);
  const mapped = sourcePoint.applyMatrix4(transform);
  const destinationLocal = mapped.clone().applyMatrix4(portalB.clone().invert());
  assertClose(destinationLocal.z, -4.5);
});

test("crossing is continuous at the portal plane", () => {
  const transform = portalPairTransform(portalA, portalB);
  const inFront = new Vector3(0, 1.7, -8.2 + 0.001).applyMatrix4(transform);
  const onPlane = new Vector3(0, 1.7, -8.2).applyMatrix4(transform);
  const behind = new Vector3(0, 1.7, -8.2 - 0.001).applyMatrix4(transform);
  assertClose(inFront.distanceTo(onPlane), 0.001, 1e-8);
  assertClose(behind.distanceTo(onPlane), 0.001, 1e-8);
});

test("forward and return transforms are inverse", () => {
  const forward = portalPairTransform(portalA, portalB);
  const backward = portalPairTransform(portalB, portalA);
  assertMatrixClose(forward.clone().multiply(backward), new Matrix4(), 1e-8);
});

test("paired camera keeps position, orientation and projection continuity", () => {
  const cameraMatrix = new Matrix4().makeRotationX(-0.02);
  cameraMatrix.setPosition(0.2, 1.7, -3.5);
  const transform = portalPairTransform(portalA, portalB);
  const mapped = transform.clone().multiply(cameraMatrix);
  const pose = poseFromMatrix(mapped);
  assert.ok(pose.position.distanceTo(new Vector3().setFromMatrixPosition(mapped)) < EPSILON);
  const expectedQuaternion = new Quaternion().setFromRotationMatrix(mapped);
  assert.ok(pose.quaternion.angleTo(expectedQuaternion) < EPSILON);
});

test("portal side and aperture tests reject movement outside the opening", () => {
  assert.ok(signedPortalDistance(new Vector3(0, 1.7, -4), portalA) > 0);
  assert.ok(signedPortalDistance(new Vector3(0, 1.7, -10), portalA) < 0);
  assert.equal(isInsideAperture(new Vector3(0, 1.7, -8.2), portalA, 2.12, 3.18), true);
  assert.equal(isInsideAperture(new Vector3(1.2, 1.7, -8.2), portalA, 2.12, 3.18), false);
});

test("the two rooms use distinct positions and directions", () => {
  const positionA = new Vector3().setFromMatrixPosition(portalA);
  const positionB = new Vector3().setFromMatrixPosition(portalB);
  const normalA = new Vector3(0, 0, 1).transformDirection(portalA);
  const normalB = new Vector3(0, 0, 1).transformDirection(portalB);
  assert.ok(positionA.distanceTo(positionB) > 10);
  assert.ok(normalA.angleTo(normalB) > 0.5);
});
