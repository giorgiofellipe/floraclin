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

  it('rejects crop that exceeds image bounds (x + width > 1)', () => {
    const result = photoCropSchema.safeParse({
      ...validCrop,
      x: 0.8,
      width: 0.5,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('Recorte excede os limites da imagem')
    }
  })
})

describe('saveCropSchema', () => {
  it('wraps crop in cropBox field', () => {
    const result = saveCropSchema.safeParse({ cropBox: validCrop })
    expect(result.success).toBe(true)
  })
})
