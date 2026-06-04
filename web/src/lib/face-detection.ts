'use client'

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision'

export interface FaceDetectionResult {
  landmarks: {
    leftEye: { x: number; y: number }
    rightEye: { x: number; y: number }
    noseTip: { x: number; y: number }
    interPupillaryDistance: number
  }
  boundingBox: { x: number; y: number; width: number; height: number }
  rotation: { yaw: number; pitch: number; roll: number }
  gaze: { leftRatio: number; rightRatio: number }
}

// Pin to installed version to avoid silent CDN breakage
const MEDIAPIPE_VERSION = '0.10.35'
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

let landmarkerInstance: FaceLandmarker | null = null
let initPromise: Promise<FaceLandmarker> | null = null
let currentRunningMode: 'IMAGE' | 'VIDEO' = 'IMAGE'
let detecting = false

async function getLandmarker(mode: 'IMAGE' | 'VIDEO' = 'IMAGE'): Promise<FaceLandmarker> {
  if (landmarkerInstance) {
    if (currentRunningMode !== mode) {
      landmarkerInstance.setOptions({ runningMode: mode })
      currentRunningMode = mode
    }
    return landmarkerInstance
  }
  if (initPromise) {
    const lm = await initPromise
    if (currentRunningMode !== mode) {
      lm.setOptions({ runningMode: mode })
      currentRunningMode = mode
    }
    return lm
  }

  initPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      landmarkerInstance = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: mode,
        numFaces: 1,
        minFaceDetectionConfidence: 0.3,
        minFacePresenceConfidence: 0.3,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      })
      currentRunningMode = mode
      return landmarkerInstance
    } catch (err) {
      initPromise = null
      throw err
    }
  })()

  return initPromise
}

// MediaPipe landmark indices for key facial points
const LEFT_EYE_CENTER = 468
const RIGHT_EYE_CENTER = 473
const NOSE_TIP = 1
const LEFT_EYE_INNER = 133
const LEFT_EYE_OUTER = 33
const RIGHT_EYE_INNER = 362
const RIGHT_EYE_OUTER = 263

function parseDetectionResult(
  faceLandmarks: Array<Array<{ x: number; y: number; z: number }>>,
): FaceDetectionResult | null {
  if (!faceLandmarks || faceLandmarks.length === 0) return null

  const lm = faceLandmarks[0]
  const leftEye = lm[LEFT_EYE_CENTER]
  const rightEye = lm[RIGHT_EYE_CENTER]
  const nose = lm[NOSE_TIP]
  const leInner = lm[LEFT_EYE_INNER]
  const leOuter = lm[LEFT_EYE_OUTER]
  const reInner = lm[RIGHT_EYE_INNER]
  const reOuter = lm[RIGHT_EYE_OUTER]

  const ipd = Math.sqrt(
    (rightEye.x - leftEye.x) ** 2 + (rightEye.y - leftEye.y) ** 2
  )

  let minX = 1, minY = 1, maxX = 0, maxY = 0
  for (const point of lm) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }

  // Derive yaw/pitch/roll from landmark geometry (more reliable than
  // transformation matrix indices which vary across MediaPipe versions)
  const eyeMidX = (leftEye.x + rightEye.x) / 2
  const eyeMidY = (leftEye.y + rightEye.y) / 2
  const noseOffsetX = nose.x - eyeMidX
  const noseOffsetY = nose.y - eyeMidY
  const yaw = Math.atan2(noseOffsetX, ipd) * (180 / Math.PI) * 2
  const pitch = Math.atan2(noseOffsetY - ipd * 0.6, ipd) * (180 / Math.PI)
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI)

  const leWidth = leOuter.x - leInner.x
  const reWidth = reInner.x - reOuter.x
  const leftGaze = leWidth !== 0 ? (leftEye.x - leInner.x) / leWidth : 0.5
  const rightGaze = reWidth !== 0 ? (rightEye.x - reOuter.x) / reWidth : 0.5

  return {
    landmarks: {
      leftEye: { x: leftEye.x, y: leftEye.y },
      rightEye: { x: rightEye.x, y: rightEye.y },
      noseTip: { x: nose.x, y: nose.y },
      interPupillaryDistance: ipd,
    },
    boundingBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    rotation: { yaw, pitch, roll },
    gaze: { leftRatio: leftGaze, rightRatio: rightGaze },
  }
}

export async function detectFace(
  source: HTMLImageElement | HTMLCanvasElement
): Promise<FaceDetectionResult | null> {
  const landmarker = await getLandmarker('IMAGE')
  const result = landmarker.detect(source)
  return parseDetectionResult(result.faceLandmarks as Array<Array<{ x: number; y: number; z: number }>>)
}

export async function detectFaceFromVideo(
  video: HTMLVideoElement,
  timestampMs: number
): Promise<FaceDetectionResult | null> {
  if (detecting) return null
  detecting = true
  try {
    const landmarker = await getLandmarker('VIDEO')
    const result = landmarker.detectForVideo(video, timestampMs)
    return parseDetectionResult(result.faceLandmarks as Array<Array<{ x: number; y: number; z: number }>>)
  } finally {
    detecting = false
  }
}

export function disposeLandmarker() {
  if (landmarkerInstance) {
    landmarkerInstance.close()
    landmarkerInstance = null
    initPromise = null
    currentRunningMode = 'IMAGE'
  }
}
