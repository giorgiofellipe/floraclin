import { describe, it, expect } from 'vitest'
import {
  computeAutoCrop,
  computeAlignmentTransform,
  alignmentTransformToCssMatrix,
} from '../face-alignment'
import type { FaceDetectionResult } from '../face-detection'

function makeFaceResult(overrides?: Partial<FaceDetectionResult>): FaceDetectionResult {
  return {
    landmarks: {
      leftEye: { x: 0.35, y: 0.35 },
      rightEye: { x: 0.65, y: 0.35 },
      noseTip: { x: 0.5, y: 0.5 },
      interPupillaryDistance: 0.3,
    },
    boundingBox: { x: 0.25, y: 0.2, width: 0.5, height: 0.6 },
    rotation: { yaw: 0, pitch: 0, roll: 0 },
    gaze: { leftRatio: 0.5, rightRatio: 0.5 },
    ...overrides,
  }
}

describe('computeAutoCrop', () => {
  it('positions eye line at ~30% from top for 3:4 aspect', () => {
    const detection = makeFaceResult()
    const crop = computeAutoCrop(detection, '3:4')

    // Eye center Y is 0.35; crop should place that at 30% from top
    const eyeRelativeY = (0.35 - crop.y) / crop.height
    expect(eyeRelativeY).toBeCloseTo(0.30, 1)
  })

  it('centers the crop horizontally on the face', () => {
    const detection = makeFaceResult()
    const crop = computeAutoCrop(detection, '3:4')

    const cropCenterX = crop.x + crop.width / 2
    const eyeCenterX = 0.5
    expect(cropCenterX).toBeCloseTo(eyeCenterX, 1)
  })

  it('clamps crop fully within image bounds', () => {
    const detection = makeFaceResult({
      landmarks: {
        leftEye: { x: 0.05, y: 0.05 },
        rightEye: { x: 0.15, y: 0.05 },
        noseTip: { x: 0.1, y: 0.15 },
        interPupillaryDistance: 0.1,
      },
      boundingBox: { x: 0.0, y: 0.0, width: 0.2, height: 0.3 },
    })
    const crop = computeAutoCrop(detection, '3:4')
    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.y).toBeGreaterThanOrEqual(0)
    expect(crop.x + crop.width).toBeLessThanOrEqual(1)
    expect(crop.y + crop.height).toBeLessThanOrEqual(1)
  })

  it('handles close-up face where padded size exceeds 1.0', () => {
    const detection = makeFaceResult({
      boundingBox: { x: 0.1, y: 0.05, width: 0.8, height: 0.9 },
    })
    const crop = computeAutoCrop(detection, '3:4')
    expect(crop.width).toBeLessThanOrEqual(1)
    expect(crop.height).toBeLessThanOrEqual(1)
    expect(crop.x + crop.width).toBeLessThanOrEqual(1)
    expect(crop.y + crop.height).toBeLessThanOrEqual(1)
  })

  it('handles free aspect ratio', () => {
    const detection = makeFaceResult()
    const crop = computeAutoCrop(detection, 'free')
    expect(crop.width).toBeGreaterThan(0)
    expect(crop.height).toBeGreaterThan(0)
  })
})

describe('computeAlignmentTransform', () => {
  it('returns identity-like transform for identical landmarks', () => {
    const landmarks = {
      leftEye: { x: 0.35, y: 0.35 },
      rightEye: { x: 0.65, y: 0.35 },
    }
    const t = computeAlignmentTransform(landmarks, landmarks, 800, 1000)
    expect(t).not.toBeNull()
    expect(t!.scale).toBeCloseTo(1)
    expect(t!.rotation).toBeCloseTo(0)
  })

  it('computes scale when target face is smaller', () => {
    const ref = {
      leftEye: { x: 0.3, y: 0.4 },
      rightEye: { x: 0.7, y: 0.4 },
    }
    const target = {
      leftEye: { x: 0.4, y: 0.4 },
      rightEye: { x: 0.6, y: 0.4 },
    }
    const t = computeAlignmentTransform(ref, target, 800, 1000)
    expect(t).not.toBeNull()
    expect(t!.scale).toBeCloseTo(2)
  })

  it('computes rotation when target face is tilted', () => {
    const ref = {
      leftEye: { x: 0.3, y: 0.5 },
      rightEye: { x: 0.7, y: 0.5 },
    }
    const target = {
      leftEye: { x: 0.3, y: 0.4 },
      rightEye: { x: 0.7, y: 0.5 },
    }
    const t = computeAlignmentTransform(ref, target, 800, 1000)
    expect(t).not.toBeNull()
    expect(t!.rotation).not.toBeCloseTo(0)
  })

  it('returns null for zero inter-pupillary distance', () => {
    const ref = {
      leftEye: { x: 0.5, y: 0.5 },
      rightEye: { x: 0.5, y: 0.5 },
    }
    const target = {
      leftEye: { x: 0.3, y: 0.4 },
      rightEye: { x: 0.7, y: 0.4 },
    }
    const t = computeAlignmentTransform(ref, target, 800, 1000)
    expect(t).toBeNull()
  })
})

describe('alignmentTransformToCssMatrix', () => {
  it('produces a valid CSS matrix() string', () => {
    const t = { scale: 1, rotation: 0, translateX: 0, translateY: 0 }
    const css = alignmentTransformToCssMatrix(t)
    expect(css).toMatch(/^matrix\(/)
    expect(css).toContain('1')
  })
})
