import type { FaceDetectionResult } from './face-detection'

export interface CropGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface AlignmentTransform {
  scale: number
  rotation: number // radians
  translateX: number // pixels
  translateY: number // pixels
}

interface LandmarkPair {
  leftEye: { x: number; y: number }
  rightEye: { x: number; y: number }
}

const ASPECT_RATIOS: Record<string, number> = {
  '3:4': 3 / 4,
  '4:3': 4 / 3,
  '1:1': 1,
}

const EYE_LINE_RATIO = 0.42
const FACE_PADDING = 0.45
const YAW_OFFSET_MAX = 0.10

export function computeAutoCrop(
  detection: FaceDetectionResult,
  aspect: '3:4' | '4:3' | '1:1' | 'free',
  imageDimensions?: { width: number; height: number },
): CropGeometry {
  const { boundingBox, landmarks, rotation } = detection
  const eyeCenterY = (landmarks.leftEye.y + landmarks.rightEye.y) / 2
  const eyeCenterX = (landmarks.leftEye.x + landmarks.rightEye.x) / 2

  const faceH = boundingBox.height
  const paddedH = faceH * (1 + FACE_PADDING * 2)

  let cropH: number
  let cropW: number

  if (aspect === 'free') {
    cropH = paddedH
    cropW = boundingBox.width * (1 + FACE_PADDING * 2)
  } else {
    const targetPixelRatio = ASPECT_RATIOS[aspect]
    cropH = paddedH
    if (imageDimensions) {
      cropW = targetPixelRatio * cropH * imageDimensions.height / imageDimensions.width
    } else {
      cropW = cropH * targetPixelRatio
    }
  }

  cropW = Math.min(cropW, 1)
  cropH = Math.min(cropH, 1)

  const yaw = rotation?.yaw ?? 0
  const absYaw = Math.abs(yaw)
  const yawSign = yaw >= 0 ? 1 : -1

  // Smooth blend between eye center and bounding box center as yaw increases
  const bbCenterX = boundingBox.x + boundingBox.width / 2
  const blendFactor = Math.min(Math.max((absYaw - 30) / 40, 0), 1)
  const centerX = eyeCenterX + (bbCenterX - eyeCenterX) * blendFactor

  // Dead zone below 25° — no offset for frontal/near-frontal
  // Smooth ramp from 25° to 70° using a single scale
  let yawOffset = 0
  if (absYaw > 25) {
    const rampFactor = Math.min((absYaw - 25) / 45, 1)
    yawOffset = -yawSign * rampFactor * cropW * YAW_OFFSET_MAX
  }

  const cropY = eyeCenterY - cropH * EYE_LINE_RATIO
  const cropX = centerX - cropW / 2 + yawOffset

  return {
    x: Math.max(0, Math.min(cropX, 1 - cropW)),
    y: Math.max(0, Math.min(cropY, 1 - cropH)),
    width: cropW,
    height: cropH,
  }
}

export function computeAlignmentTransform(
  referenceLandmarks: LandmarkPair,
  targetLandmarks: LandmarkPair,
  containerWidth: number,
  containerHeight: number,
): AlignmentTransform | null {
  const refDx = referenceLandmarks.rightEye.x - referenceLandmarks.leftEye.x
  const refDy = referenceLandmarks.rightEye.y - referenceLandmarks.leftEye.y
  const refAngle = Math.atan2(refDy, refDx)
  const refDist = Math.sqrt(refDx * refDx + refDy * refDy)

  const tgtDx = targetLandmarks.rightEye.x - targetLandmarks.leftEye.x
  const tgtDy = targetLandmarks.rightEye.y - targetLandmarks.leftEye.y
  const tgtAngle = Math.atan2(tgtDy, tgtDx)
  const tgtDist = Math.sqrt(tgtDx * tgtDx + tgtDy * tgtDy)

  if (refDist < 1e-6 || tgtDist < 1e-6) return null

  const scale = refDist / tgtDist
  const rotation = refAngle - tgtAngle

  // Convert normalized coords to pixel space for CSS transform
  const refCx = ((referenceLandmarks.leftEye.x + referenceLandmarks.rightEye.x) / 2) * containerWidth
  const refCy = ((referenceLandmarks.leftEye.y + referenceLandmarks.rightEye.y) / 2) * containerHeight
  const tgtCx = ((targetLandmarks.leftEye.x + targetLandmarks.rightEye.x) / 2) * containerWidth
  const tgtCy = ((targetLandmarks.leftEye.y + targetLandmarks.rightEye.y) / 2) * containerHeight

  const cos = Math.cos(rotation) * scale
  const sin = Math.sin(rotation) * scale
  const translateX = refCx - (cos * tgtCx - sin * tgtCy)
  const translateY = refCy - (sin * tgtCx + cos * tgtCy)

  return { scale, rotation, translateX, translateY }
}

export function alignmentTransformToCssMatrix(t: AlignmentTransform): string {
  const cos = Math.cos(t.rotation) * t.scale
  const sin = Math.sin(t.rotation) * t.scale
  return `matrix(${cos}, ${sin}, ${-sin}, ${cos}, ${t.translateX}, ${t.translateY})`
}
