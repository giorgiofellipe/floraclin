# Image Comparison & Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add face-landmark-based auto-crop, aligned comparison, and capture pose guide for clinical before/after photography.

**Architecture:** Client-side face detection via MediaPipe FaceLandmarker (WASM). Non-destructive crop stored in existing `cropBox` jsonb column. Alignment computed from stored landmarks at comparison time via CSS `matrix()` transforms.

**Tech Stack:** MediaPipe FaceLandmarker (`@mediapipe/tasks-vision`), React, Konva (already installed), Drizzle ORM, Zod.

---

## File Ownership Map

| File | Created/Modified | Task(s) |
|------|-----------------|---------|
| `web/src/lib/face-detection.ts` | Create | 1 |
| `web/src/lib/__tests__/face-detection.test.ts` | Create | 1 |
| `web/src/lib/face-alignment.ts` | Create | 2 |
| `web/src/lib/__tests__/face-alignment.test.ts` | Create | 2 |
| `web/src/validations/photo-crop.ts` | Create | 3 |
| `web/src/validations/__tests__/photo-crop.test.ts` | Create | 3 |
| `web/src/db/queries/photos.ts` | Modify | 4 |
| `web/src/app/api/photos/[id]/crop/route.ts` | Create | 5 |
| `web/src/components/photos/photo-crop-editor.tsx` | Create | 6 |
| `web/src/components/photos/capture-pose-guide.tsx` | Create | 7 |
| `web/src/components/photos/photo-grid.tsx` | Modify | 8 |
| `web/src/components/photos/photo-comparison.tsx` | Modify | 9 |
| `web/src/components/patients/patient-photos-tab.tsx` | Modify | 10 |

---

## Group A (parallel) — Foundation Libraries

### Task 1: Face Detection Service

**Files:**
- Create: `web/src/lib/face-detection.ts`
- Create: `web/src/lib/__tests__/face-detection.test.ts`

- [ ] **Step 1: Install @mediapipe/tasks-vision**

Run: `pnpm --filter @floraclin/web add @mediapipe/tasks-vision`
Expected: Package added to web/package.json dependencies

- [ ] **Step 2: Write the face detection singleton**

Create `web/src/lib/face-detection.ts`:

```ts
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
}

// Pin to installed version to avoid silent CDN breakage
const MEDIAPIPE_VERSION = '0.10.18'
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

let landmarkerInstance: FaceLandmarker | null = null
let initPromise: Promise<FaceLandmarker> | null = null
let currentRunningMode: 'IMAGE' | 'VIDEO' = 'IMAGE'

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
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: mode,
        numFaces: 1,
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

function parseDetectionResult(
  faceLandmarks: Array<Array<{ x: number; y: number; z: number }>>,
): FaceDetectionResult | null {
  if (!faceLandmarks || faceLandmarks.length === 0) return null

  const lm = faceLandmarks[0]
  const leftEye = lm[LEFT_EYE_CENTER]
  const rightEye = lm[RIGHT_EYE_CENTER]
  const nose = lm[NOSE_TIP]

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

  return {
    landmarks: {
      leftEye: { x: leftEye.x, y: leftEye.y },
      rightEye: { x: rightEye.x, y: rightEye.y },
      noseTip: { x: nose.x, y: nose.y },
      interPupillaryDistance: ipd,
    },
    boundingBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    rotation: { yaw, pitch, roll },
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
  const landmarker = await getLandmarker('VIDEO')
  const result = landmarker.detectForVideo(video, timestampMs)
  return parseDetectionResult(result.faceLandmarks as Array<Array<{ x: number; y: number; z: number }>>)
}

export function disposeLandmarker() {
  if (landmarkerInstance) {
    landmarkerInstance.close()
    landmarkerInstance = null
    initPromise = null
    currentRunningMode = 'IMAGE'
  }
}
```

- [ ] **Step 3: Write unit test**

Create `web/src/lib/__tests__/face-detection.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the MediaPipe module since WASM doesn't run in vitest
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: vi.fn().mockResolvedValue({}),
  },
  FaceLandmarker: {
    createFromOptions: vi.fn().mockResolvedValue({
      detect: vi.fn().mockReturnValue({
        faceLandmarks: [],
        facialTransformationMatrixes: [],
      }),
      detectForVideo: vi.fn().mockReturnValue({
        faceLandmarks: [],
        facialTransformationMatrixes: [],
      }),
      setOptions: vi.fn(),
      close: vi.fn(),
    }),
  },
}))

describe('face-detection', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns null when no face is detected', async () => {
    const { detectFace } = await import('../face-detection')
    const img = {} as HTMLImageElement
    const result = await detectFace(img)
    expect(result).toBeNull()
  })

  it('exports detectFaceFromVideo and disposeLandmarker', async () => {
    const { detectFaceFromVideo, disposeLandmarker } = await import('../face-detection')
    expect(typeof detectFaceFromVideo).toBe('function')
    expect(typeof disposeLandmarker).toBe('function')
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @floraclin/web test:run -- --reporter=verbose src/lib/__tests__/face-detection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/face-detection.ts web/src/lib/__tests__/face-detection.test.ts web/package.json pnpm-lock.yaml
git commit -m "feat(photos): add MediaPipe face detection service"
```

---

### Task 2: Face Alignment Utilities

**Files:**
- Create: `web/src/lib/face-alignment.ts`
- Create: `web/src/lib/__tests__/face-alignment.test.ts`

- [ ] **Step 1: Write face alignment pure functions**

Create `web/src/lib/face-alignment.ts`:

```ts
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

const EYE_LINE_RATIO = 0.30
const FACE_PADDING = 0.35

export function computeAutoCrop(
  detection: FaceDetectionResult,
  aspect: '3:4' | '4:3' | '1:1' | 'free',
  imageWidth: number,
  imageHeight: number,
): CropGeometry {
  const { boundingBox, landmarks } = detection
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
    const ratio = ASPECT_RATIOS[aspect]
    cropH = paddedH
    cropW = cropH * ratio
  }

  // Clamp dimensions first, then position
  cropW = Math.min(cropW, 1)
  cropH = Math.min(cropH, 1)

  const cropY = eyeCenterY - cropH * EYE_LINE_RATIO
  const cropX = eyeCenterX - cropW / 2

  return {
    x: Math.max(0, Math.min(cropX, 1 - cropW)),
    y: Math.max(0, Math.min(cropY, 1 - cropH)),
    width: cropW,
    height: cropH,
  }
}

export function computeAlignmentTransform(
  referencelandmarks: LandmarkPair,
  targetLandmarks: LandmarkPair,
  containerWidth: number,
  containerHeight: number,
): AlignmentTransform | null {
  const refDx = referencelandmarks.rightEye.x - referencelandmarks.leftEye.x
  const refDy = referencelandmarks.rightEye.y - referencelandmarks.leftEye.y
  const refAngle = Math.atan2(refDy, refDx)
  const refDist = Math.sqrt(refDx * refDx + refDy * refDy)

  const tgtDx = targetLandmarks.rightEye.x - targetLandmarks.leftEye.x
  const tgtDy = targetLandmarks.rightEye.y - targetLandmarks.leftEye.y
  const tgtAngle = Math.atan2(tgtDy, tgtDx)
  const tgtDist = Math.sqrt(tgtDx * tgtDx + tgtDy * tgtDy)

  if (tgtDist < 1e-6) return null

  const scale = refDist / tgtDist
  const rotation = refAngle - tgtAngle

  // Convert normalized coords to pixel space for CSS transform
  const refCx = ((referencelandmarks.leftEye.x + referencelandmarks.rightEye.x) / 2) * containerWidth
  const refCy = ((referencelandmarks.leftEye.y + referencelandmarks.rightEye.y) / 2) * containerHeight
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
```

- [ ] **Step 2: Write the failing tests**

Create `web/src/lib/__tests__/face-alignment.test.ts`:

```ts
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
    ...overrides,
  }
}

describe('computeAutoCrop', () => {
  it('positions eye line at ~30% from top for 3:4 aspect', () => {
    const detection = makeFaceResult()
    const crop = computeAutoCrop(detection, '3:4', 1000, 1333)

    // Eye center Y is 0.35; crop should place that at 30% from top
    const eyeRelativeY = (0.35 - crop.y) / crop.height
    expect(eyeRelativeY).toBeCloseTo(0.30, 1)
  })

  it('centers the crop horizontally on the face', () => {
    const detection = makeFaceResult()
    const crop = computeAutoCrop(detection, '3:4', 1000, 1333)

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
    const crop = computeAutoCrop(detection, '3:4', 500, 667)
    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.y).toBeGreaterThanOrEqual(0)
    expect(crop.x + crop.width).toBeLessThanOrEqual(1)
    expect(crop.y + crop.height).toBeLessThanOrEqual(1)
  })

  it('handles close-up face where padded size exceeds 1.0', () => {
    const detection = makeFaceResult({
      boundingBox: { x: 0.1, y: 0.05, width: 0.8, height: 0.9 },
    })
    const crop = computeAutoCrop(detection, '3:4', 1000, 1333)
    expect(crop.width).toBeLessThanOrEqual(1)
    expect(crop.height).toBeLessThanOrEqual(1)
    expect(crop.x + crop.width).toBeLessThanOrEqual(1)
    expect(crop.y + crop.height).toBeLessThanOrEqual(1)
  })

  it('handles free aspect ratio', () => {
    const detection = makeFaceResult()
    const crop = computeAutoCrop(detection, 'free', 1000, 1000)
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
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @floraclin/web test:run -- --reporter=verbose src/lib/__tests__/face-alignment.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/face-alignment.ts web/src/lib/__tests__/face-alignment.test.ts
git commit -m "feat(photos): add face alignment transform utilities"
```

---

### Task 3: Crop Validation Schema

**Files:**
- Create: `web/src/validations/photo-crop.ts`
- Create: `web/src/validations/__tests__/photo-crop.test.ts`

- [ ] **Step 1: Write the Zod schema**

Create `web/src/validations/photo-crop.ts`:

```ts
import { z } from 'zod'

const coord = z.number().min(0).max(1)

const landmarksSchema = z.object({
  leftEye: z.object({ x: coord, y: coord }),
  rightEye: z.object({ x: coord, y: coord }),
  noseTip: z.object({ x: coord, y: coord }),
  interPupillaryDistance: z.number().min(0).max(1),
})

export const photoCropSchema = z.object({
  x: coord,
  y: coord,
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
  rotation: z.number().min(-360).max(360),
  landmarks: landmarksSchema.optional(),
  aspect: z.enum(['3:4', '4:3', '1:1', 'free']),
}).refine(
  (d) => d.x + d.width <= 1.0001 && d.y + d.height <= 1.0001,
  { message: 'Recorte excede os limites da imagem' },
)

export type PhotoCropData = z.infer<typeof photoCropSchema>

export const saveCropSchema = z.object({
  cropBox: photoCropSchema,
})

export type SaveCropData = z.infer<typeof saveCropSchema>
```

- [ ] **Step 2: Write tests**

Create `web/src/validations/__tests__/photo-crop.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { photoCropSchema, saveCropSchema } from '../photo-crop'

const validCrop = {
  x: 0.1,
  y: 0.05,
  width: 0.8,
  height: 0.9,
  rotation: 0,
  aspect: '3:4' as const,
  landmarks: {
    leftEye: { x: 0.35, y: 0.3 },
    rightEye: { x: 0.65, y: 0.3 },
    noseTip: { x: 0.5, y: 0.5 },
    interPupillaryDistance: 0.3,
  },
}

describe('photoCropSchema', () => {
  it('accepts a valid crop with landmarks', () => {
    const result = photoCropSchema.safeParse(validCrop)
    expect(result.success).toBe(true)
  })

  it('accepts a crop without landmarks', () => {
    const { landmarks: _, ...withoutLandmarks } = validCrop
    const result = photoCropSchema.safeParse(withoutLandmarks)
    expect(result.success).toBe(true)
  })

  it('rejects coordinates outside 0-1 range', () => {
    const result = photoCropSchema.safeParse({ ...validCrop, x: 1.5 })
    expect(result.success).toBe(false)
  })

  it('rejects negative coordinates', () => {
    const result = photoCropSchema.safeParse({ ...validCrop, y: -0.1 })
    expect(result.success).toBe(false)
  })

  it('rejects zero width', () => {
    const result = photoCropSchema.safeParse({ ...validCrop, width: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects rotation beyond ±360', () => {
    const result = photoCropSchema.safeParse({ ...validCrop, rotation: 400 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid aspect ratio', () => {
    const result = photoCropSchema.safeParse({ ...validCrop, aspect: '16:9' })
    expect(result.success).toBe(false)
  })

  it('accepts all valid aspect ratios', () => {
    for (const aspect of ['3:4', '4:3', '1:1', 'free']) {
      const result = photoCropSchema.safeParse({ ...validCrop, aspect })
      expect(result.success).toBe(true)
    }
  })
})

describe('saveCropSchema', () => {
  it('wraps crop in cropBox field', () => {
    const result = saveCropSchema.safeParse({ cropBox: validCrop })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @floraclin/web test:run -- --reporter=verbose src/validations/__tests__/photo-crop.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/validations/photo-crop.ts web/src/validations/__tests__/photo-crop.test.ts
git commit -m "feat(photos): add Zod schema for crop data validation"
```

---

## Group B (sequential, depends on A) — Backend

### Task 4: DB Queries — updateCropBox + include cropBox in responses

**Files:**
- Modify: `web/src/db/queries/photos.ts`

- [ ] **Step 1: Add cropBox to the PhotoAssetWithUrl type and listPhotos select**

In `web/src/db/queries/photos.ts`, add `cropBox` to the `PhotoAssetWithUrl` interface (line 11):

```ts
// Add import at top of file:
import type { PhotoCropData } from '@/validations/photo-crop'

// Add after line 25 (hasAnnotation field):
  cropBox: PhotoCropData | null
```

Add `cropBox` to the `select` call in `listPhotos` (after line 65):

```ts
      cropBox: photoAssets.cropBox,
```

Add `cropBox` to the mapping in `photosWithUrls` (after line 89):

```ts
      cropBox: (photo.cropBox ?? null) as PhotoCropData | null,
```

- [ ] **Step 2: Add cropBox to getComparisonUrls response**

Modify `getComparisonUrls` to also return `cropBox` data:

```ts
export async function getComparisonUrls(
  tenantId: string,
  photoIdA: string,
  photoIdB: string
): Promise<{
  urlA: string | null
  urlB: string | null
  cropBoxA: PhotoCropData | null
  cropBoxB: PhotoCropData | null
}> {
  const [photoA, photoB] = await Promise.all([
    getPhotoAsset(tenantId, photoIdA),
    getPhotoAsset(tenantId, photoIdB),
  ])

  const [urlA, urlB] = await Promise.all([
    photoA ? getSignedUrl(photoA.storagePath) : null,
    photoB ? getSignedUrl(photoB.storagePath) : null,
  ])

  return {
    urlA,
    urlB,
    cropBoxA: (photoA?.cropBox ?? null) as PhotoCropData | null,
    cropBoxB: (photoB?.cropBox ?? null) as PhotoCropData | null,
  }
}
```

- [ ] **Step 3: Add updateCropBox function**

Add at the end of the file, before the comparison helper section:

```ts
// ─── Crop ──────────────────────────────────────────────────────────

export async function updateCropBox(
  tenantId: string,
  photoId: string,
  cropBox: PhotoCropData,
) {
  const photo = await getPhotoAsset(tenantId, photoId)
  if (!photo) return null

  const [updated] = await db
    .update(photoAssets)
    .set({ cropBox })
    .where(
      and(
        eq(photoAssets.tenantId, tenantId),
        eq(photoAssets.id, photoId),
      )
    )
    .returning()

  return updated
}
```

- [ ] **Step 4: Run existing tests to verify nothing breaks**

Run: `pnpm --filter @floraclin/web test:run -- --reporter=verbose`
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add web/src/db/queries/photos.ts
git commit -m "feat(photos): add cropBox to photo responses and updateCropBox query"
```

---

### Task 5: PATCH Crop API Endpoint

**Files:**
- Create: `web/src/app/api/photos/[id]/crop/route.ts`

- [ ] **Step 1: Create the directory structure**

Run: `mkdir -p web/src/app/api/photos/\[id\]/crop`

- [ ] **Step 2: Write the PATCH handler**

Create `web/src/app/api/photos/[id]/crop/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { updateCropBox, getPhotoAsset } from '@/db/queries/photos'
import { saveCropSchema } from '@/validations/photo-crop'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireRole('owner', 'practitioner')
    const { id: photoId } = await context.params

    const body = await request.json()
    const parsed = saveCropSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0]
      return NextResponse.json(
        { success: false, error: firstError ?? 'Dados de recorte inválidos' },
        { status: 400 },
      )
    }

    const photo = await getPhotoAsset(auth.tenantId, photoId)
    if (!photo) {
      return NextResponse.json(
        { success: false, error: 'Foto não encontrada' },
        { status: 404 },
      )
    }

    await updateCropBox(auth.tenantId, photoId, parsed.data.cropBox)
    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('Crop update error:', error)
    return NextResponse.json(
      { success: false, error: 'Erro interno ao salvar recorte' },
      { status: 500 },
    )
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/photos/\[id\]/crop/route.ts
git commit -m "feat(photos): add PATCH /api/photos/[id]/crop endpoint"
```

---

## Group C (parallel, depends on B) — New UI Components

### Task 6: Photo Crop Editor Component

**Files:**
- Create: `web/src/components/photos/photo-crop-editor.tsx`

- [ ] **Step 1: Write the crop editor component**

Create `web/src/components/photos/photo-crop-editor.tsx`. This component renders a modal dialog with:

1. An image with a draggable crop overlay
2. Aspect ratio selector toolbar
3. Landmark dots and reference lines when face is detected
4. Save/cancel buttons

The component receives a `PhotoAssetWithUrl`, runs face detection on open, computes an auto-crop suggestion, and lets the user adjust. On save, it calls `PATCH /api/photos/[id]/crop`.

Key implementation details:

- Use a `<canvas>` element to render the image with crop overlay
- Crop handles are absolutely positioned divs over the canvas
- Dark semi-transparent overlay outside the crop region using CSS `clip-path`
- Landmark dots as absolutely positioned green circles
- Eye line as an absolutely positioned green horizontal line
- Drag interaction via `onPointerDown` / `onPointerMove` / `onPointerUp` on the container

The component should be ~300-400 lines. Core state:

```ts
const [cropBox, setCropBox] = useState<CropGeometry | null>(null)
const [landmarks, setLandmarks] = useState<FaceDetectionResult['landmarks'] | null>(null)
const [aspect, setAspect] = useState<'3:4' | '4:3' | '1:1' | 'free'>('3:4')
const [rotation, setRotation] = useState(0)
const [detecting, setDetecting] = useState(false)
const [saving, setSaving] = useState(false)
const [dragState, setDragState] = useState<DragState | null>(null)
```

Props interface:

```ts
interface PhotoCropEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  photo: PhotoAssetWithUrl | null
  onSaved?: () => void
}
```

On mount/open:
1. Fetch fresh signed URL for the photo
2. Load image into an `<img>` element
3. Run `detectFace()` from `@/lib/face-detection`
4. If face found, call `computeAutoCrop()` from `@/lib/face-alignment`
5. Set initial crop state

On save:
1. Build `PhotoCropData` from crop state + landmarks
2. `fetch(`/api/photos/${photo.id}/crop`, { method: 'PATCH', body: JSON.stringify({ cropBox: data }) })`
3. Call `onSaved()` callback
4. Close dialog

- [ ] **Step 2: Commit**

```bash
git add web/src/components/photos/photo-crop-editor.tsx
git commit -m "feat(photos): add photo crop editor with face detection"
```

---

### Task 7: Capture Pose Guide Component

**Files:**
- Create: `web/src/components/photos/capture-pose-guide.tsx`

- [ ] **Step 1: Write the capture pose guide component**

Create `web/src/components/photos/capture-pose-guide.tsx`. This component renders a camera dialog with:

1. Live camera feed via `getUserMedia`
2. Pose selector tabs (Frontal, 45° Esq., Perfil Esq., 45° Dir., Perfil Dir.)
3. Guide overlays (face outline oval, eye line, center line)
4. Real-time face detection with alignment feedback
5. Capture button (enabled only when aligned)

Key implementation:

- Camera feed in a `<video>` element with `autoPlay playsInline`
- `requestAnimationFrame` loop calls `detectFaceFromVideo()` at ~15fps
- Guide overlay as absolutely positioned SVG/CSS elements
- Pose configuration defines expected yaw range and guide position
- Color transitions: yellow (adjusting) → green (aligned)
- Directional hints computed from current vs. target face position

Props interface:

```ts
interface CapturePoseGuideProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  onCaptured?: (photoId: string) => void
}
```

Pose configuration:

```ts
const POSES = [
  { key: 'front', label: 'Frontal', yawRange: [-8, 8] },
  { key: 'left45', label: '45° Esq.', yawRange: [30, 55] },
  { key: 'leftProfile', label: 'Perfil Esq.', yawRange: [65, 90] },
  { key: 'right45', label: '45° Dir.', yawRange: [-55, -30] },
  { key: 'rightProfile', label: 'Perfil Dir.', yawRange: [-90, -65] },
] as const
```

On capture:
1. Draw video frame to a canvas
2. Compress via existing canvas pipeline (max 2048px, quality 0.85)
3. Convert to Blob
4. Upload via `POST /api/photos` (same as existing photo uploader)
5. Save landmarks via `PATCH /api/photos/[id]/crop` (landmarks from detection + full-frame crop)
6. Call `onCaptured(photoId)` callback
7. Toast success

Cleanup on unmount:
- Stop all camera tracks: `stream.getTracks().forEach(t => t.stop())`
- Cancel animation frame
- Call `disposeLandmarker()` if no other component is using it

- [ ] **Step 2: Commit**

```bash
git add web/src/components/photos/capture-pose-guide.tsx
git commit -m "feat(photos): add capture pose guide with real-time face detection"
```

---

## Group D (depends on C) — Integration

Tasks 8 and 9 are parallel. Task 10 runs after 8 and 9 complete (imports from both).

### Task 8: Photo Grid — Add Crop Icon

**Files:**
- Modify: `web/src/components/photos/photo-grid.tsx`

- [ ] **Step 1: Add crop icon to photo card actions**

In `web/src/components/photos/photo-grid.tsx`:

1. Add imports:
```ts
import { Trash2, ZoomIn, Pencil, Loader2, Crop } from 'lucide-react'
```

2. Add `onCrop` to the props interface (line 21):
```ts
interface PhotoGridProps {
  patientId: string
  procedureRecordId?: string
  onAnnotate?: (photo: PhotoAssetWithUrl) => void
  onCrop?: (photo: PhotoAssetWithUrl) => void  // NEW
  refreshKey?: number
  timelineStage?: string
  comparisonMode?: boolean
  selectedA?: string | null
  selectedB?: string | null
  onPhotoSelect?: (photo: PhotoAssetWithUrl) => void
}
```

3. Destructure `onCrop` in the component (line 44):
```ts
  onCrop,
```

4. Add crop button in the action toolbar, after the annotate button (after line 241). Insert before the trash button:

```tsx
{onCrop && (
  <Tooltip>
    <TooltipTrigger render={
      <div className="relative">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-9 text-mid hover:text-charcoal"
          onClick={() => onCrop(photo)}
        >
          <Crop className="size-4" />
        </Button>
        {photo.cropBox && (
          <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-sage" />
        )}
      </div>
    } />
    <TooltipContent side="top"><p>Recortar</p></TooltipContent>
  </Tooltip>
)}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/photos/photo-grid.tsx
git commit -m "feat(photos): add crop action button to photo grid"
```

---

### Task 9: Photo Comparison — Add Alignment Toggle

**Files:**
- Modify: `web/src/components/photos/photo-comparison.tsx`

- [ ] **Step 1: Add alignment state and toggle**

In `web/src/components/photos/photo-comparison.tsx`:

1. Add import:
```ts
import { computeAlignmentTransform, alignmentTransformToCssMatrix } from '@/lib/face-alignment'
import type { PhotoCropData } from '@/validations/photo-crop'
```

2. Add state for alignment and cropBox data (after line 48):
```ts
const [alignmentOn, setAlignmentOn] = useState(true)
const [cropBoxA, setCropBoxA] = useState<PhotoCropData | null>(null)
const [cropBoxB, setCropBoxB] = useState<PhotoCropData | null>(null)
```

3. Update the URL loading effect to also capture cropBox data. Modify the `loadUrls` function (lines 59-72) to also set cropBox state:
```ts
if (result.success && result.data) {
  setUrlA(result.data.urlA)
  setUrlB(result.data.urlB)
  setCropBoxA(result.data.cropBoxA as PhotoCropData | null)
  setCropBoxB(result.data.cropBoxB as PhotoCropData | null)
}
```

4. Add a ref on the slider container (or reuse existing `sliderContainerRef`) to get pixel dimensions. Compute alignment transform as a derived value:
```ts
const hasLandmarks = !!(cropBoxA?.landmarks && cropBoxB?.landmarks)
const [containerSize, setContainerSize] = React.useState({ w: 0, h: 0 })

// Update container size on render using a ResizeObserver or measuring the container ref
React.useEffect(() => {
  const el = sliderContainerRef.current
  if (!el) return
  const obs = new ResizeObserver(([entry]) => {
    setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height })
  })
  obs.observe(el)
  return () => obs.disconnect()
}, [urlA, urlB])

const alignmentCss = React.useMemo(() => {
  if (!hasLandmarks || !alignmentOn || !cropBoxA?.landmarks || !cropBoxB?.landmarks)
    return null
  if (containerSize.w === 0 || containerSize.h === 0) return null
  const transform = computeAlignmentTransform(
    cropBoxA.landmarks,
    cropBoxB.landmarks,
    containerSize.w,
    containerSize.h,
  )
  if (!transform) return null
  return alignmentTransformToCssMatrix(transform)
}, [hasLandmarks, alignmentOn, cropBoxA, cropBoxB, containerSize])
```

5. Add alignment toggle button in the top bar (after the mode selector buttons, before the close button). Only show when both photos have landmarks:
```tsx
{hasLandmarks && (
  <button
    type="button"
    onClick={() => setAlignmentOn((v) => !v)}
    className={cn(
      'flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
      alignmentOn
        ? 'bg-sage/20 text-sage'
        : 'text-white/50 hover:text-white/80'
    )}
  >
    <div className={cn(
      'h-3.5 w-6 rounded-full transition-colors relative',
      alignmentOn ? 'bg-sage' : 'bg-white/20',
    )}>
      <div className={cn(
        'absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform',
        alignmentOn ? 'translate-x-2.5' : 'translate-x-0.5',
      )} />
    </div>
    Alinhamento
  </button>
)}
```

6. Apply the CSS transform to photo B's `<img>` elements across all three modes. Add `style={{ transform: alignmentCss ?? undefined, transformOrigin: '0 0' }}` to the photo B image in slider mode (line 159), side-by-side mode (line 203), and overlay mode (line 227).

- [ ] **Step 2: Commit**

```bash
git add web/src/components/photos/photo-comparison.tsx
git commit -m "feat(photos): add landmark-based alignment toggle to comparison view"
```

---

### Task 10: Patient Photos Tab — Wire Up Crop Editor + Capture Guide

**Files:**
- Modify: `web/src/components/patients/patient-photos-tab.tsx`

- [ ] **Step 1: Add imports and state for new components**

In `web/src/components/patients/patient-photos-tab.tsx`:

1. Add imports:
```ts
import { PhotoCropEditor } from '@/components/photos/photo-crop-editor'
import { CapturePoseGuide } from '@/components/photos/capture-pose-guide'
import { Camera } from 'lucide-react'
```

2. Add state (after line 23):
```ts
const [croppingPhoto, setCroppingPhoto] = useState<PhotoAssetWithUrl | null>(null)
const [showCaptureGuide, setShowCaptureGuide] = useState(false)
```

3. Add "Capturar com guia" button in the button bar (after "Enviar Fotos" button, line 72):
```tsx
<Button variant="outline" onClick={() => setShowCaptureGuide(true)}>
  <Camera className="size-4 mr-1" />
  Capturar com guia
</Button>
```

4. Pass `onCrop` to PhotoGrid (after line 118):
```tsx
onCrop={setCroppingPhoto}
```

5. Add PhotoCropEditor and CapturePoseGuide dialogs (after the PhotoComparisonDialog, before line 141's closing `</div>`):
```tsx
<PhotoCropEditor
  open={!!croppingPhoto}
  onOpenChange={(open) => { if (!open) setCroppingPhoto(null) }}
  photo={croppingPhoto}
  onSaved={() => {
    setCroppingPhoto(null)
    setRefreshKey((k) => k + 1)
  }}
/>

<CapturePoseGuide
  open={showCaptureGuide}
  onOpenChange={setShowCaptureGuide}
  patientId={patientId}
  onCaptured={() => {
    setShowCaptureGuide(false)
    setRefreshKey((k) => k + 1)
  }}
/>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/patients/patient-photos-tab.tsx
git commit -m "feat(photos): wire crop editor and capture guide into patient photos tab"
```
