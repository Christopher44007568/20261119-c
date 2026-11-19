import { Matrix4, Quaternion, Vector3 } from "three";

const PORTAL_FLIP = new Matrix4().makeRotationY(Math.PI);
const _inverse = new Matrix4();
const _rotation = new Quaternion();
const _position = new Vector3();
const _scale = new Vector3();
const _local = new Vector3();

export function portalPairTransform(sourceMatrix, destinationMatrix, target = new Matrix4()) {
  _inverse.copy(sourceMatrix).invert();
  return target.copy(destinationMatrix).multiply(PORTAL_FLIP).multiply(_inverse);
}

export function transformCameraMatrix(sourceCameraMatrix, sourcePortal, destinationPortal, target) {
  const pair = portalPairTransform(sourcePortal.matrixWorld, destinationPortal.matrixWorld);
  return target.multiplyMatrices(pair, sourceCameraMatrix);
}

export function poseFromMatrix(matrix) {
  matrix.decompose(_position, _rotation, _scale);
  return {
    position: _position.clone(),
    quaternion: _rotation.clone(),
  };
}

export function applyPairTransformToObject(object, sourcePortal, destinationPortal) {
  const pair = portalPairTransform(sourcePortal.matrixWorld, destinationPortal.matrixWorld);
  const transformed = pair.multiply(object.matrixWorld);
  transformed.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrixWorld(true);
}

export function signedPortalDistance(worldPosition, portalMatrix, target = new Vector3()) {
  target.copy(worldPosition).applyMatrix4(_inverse.copy(portalMatrix).invert());
  return target.z;
}

export function isInsideAperture(worldPosition, portalMatrix, width, height, margin = 0) {
  _local.copy(worldPosition).applyMatrix4(_inverse.copy(portalMatrix).invert());
  return (
    Math.abs(_local.x) <= width * 0.5 + margin &&
    _local.y >= -height * 0.5 - margin &&
    _local.y <= height * 0.5 + margin
  );
}

export function localPortalPoint(worldPosition, portalMatrix, target = new Vector3()) {
  return target.copy(worldPosition).applyMatrix4(_inverse.copy(portalMatrix).invert());
}

export function cloneCameraPose(camera) {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
  };
}

export function setCameraPose(camera, pose) {
  camera.position.copy(pose.position);
  camera.quaternion.copy(pose.quaternion);
  camera.updateMatrixWorld(true);
}
