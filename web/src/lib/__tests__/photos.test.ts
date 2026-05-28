import { describe, it, expect } from 'vitest'
import { applyCrop } from '../photos'

describe('applyCrop', () => {
  it('returns null when crop is null', () => {
    expect(applyCrop(null, 1)).toBeNull()
  })

  it('computes container aspect from crop and source', () => {
    const style = applyCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, 1.5)
    expect(style?.wrapperStyle.aspectRatio).toBe('1.5')
  })

  it('sets only width on the image (height auto so the natural aspect is preserved)', () => {
    const style = applyCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, 1)
    expect(style?.imageStyle.width).toBe('200%')
    expect(style?.imageStyle.height).toBe('auto')
  })

  it('translates the image so the crop top-left aligns with the wrapper', () => {
    const style = applyCrop({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, 1)
    // CSS translate %s are relative to the element's own bounding box (the
    // rendered image, scaled by 1/crop.width with natural aspect). The pixel
    // at natural fraction crop.x lies at crop.x * imageWidth from the
    // image's left edge, so the shift is -crop.x * 100%.
    expect(style?.imageStyle.transform).toBe('translate(-25%, -50%)')
  })

  it('handles non-square source aspect ratios', () => {
    // Tall portrait source (aspect = 0.5), centered square crop of full width
    const style = applyCrop({ x: 0, y: 0.25, width: 1, height: 0.5 }, 0.5)
    // cropAspect = (1 / 0.5) * 0.5 = 1.0
    expect(style?.wrapperStyle.aspectRatio).toBe('1')
  })
})
