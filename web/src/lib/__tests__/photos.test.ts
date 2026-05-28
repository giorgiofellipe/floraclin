import { describe, it, expect } from 'vitest'
import { applyCrop } from '../photos'

describe('applyCrop', () => {
  it('returns null when crop is null', () => {
    expect(applyCrop(null, 1)).toBeNull()
  })

  it('uses padding-bottom to set wrapper height from width at the crop aspect', () => {
    // cropAspect = (0.5 / 0.5) * 1.5 = 1.5 → padding-bottom = 100/1.5 ≈ 66.67%
    const style = applyCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, 1.5)
    expect(style?.wrapperStyle.paddingBottom).toBe(`${100 / 1.5}%`)
  })

  it('caps max-width via maxHeight option so the wrapper never exceeds the viewport height', () => {
    // With cropAspect = 1.5 and maxHeight = 70vh, max-width = calc(70vh * 1.5)
    const style = applyCrop(
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      1.5,
      { maxHeight: '70vh' },
    )
    expect(style?.wrapperStyle.maxWidth).toBe('calc(70vh * 1.5)')
  })

  it('leaves max-width at 100% when no maxHeight is requested', () => {
    const style = applyCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, 1)
    expect(style?.wrapperStyle.maxWidth).toBe('100%')
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
})
