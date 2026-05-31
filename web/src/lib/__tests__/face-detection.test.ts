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
