import { describe, it, expect } from 'vitest'
import { applyCrop } from '../photos'

describe('applyCrop', () => {
  it('returns null when crop is null', () => {
    expect(applyCrop(null, 1)).toBeNull()
  })

  it('computes container aspect from crop and source', () => {
    const style = applyCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, 1.5)
    expect(style?.containerStyle.aspectRatio).toBe('1.5')
  })

  it('scales image to fill container', () => {
    const style = applyCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, 1)
    expect(style?.imageStyle.width).toBe('200%')
    expect(style?.imageStyle.height).toBe('200%')
  })

  it('translates the image so the crop top-left aligns with the container', () => {
    const style = applyCrop({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, 1)
    // scaleX = scaleY = 2, so translate is (-0.25 * 100 * 2, -0.5 * 100 * 2) = (-50%, -100%)
    expect(style?.imageStyle.transform).toBe('translate(-50%, -100%)')
  })

  it('uses object-fit cover with top-left positioning', () => {
    const style = applyCrop({ x: 0, y: 0, width: 1, height: 1 }, 1)
    expect(style?.imageStyle.objectFit).toBe('cover')
    expect(style?.imageStyle.objectPosition).toBe('top left')
  })

  it('handles non-square source aspect ratios', () => {
    // Tall portrait source (aspect = 0.5), centered square crop of full width
    const style = applyCrop({ x: 0, y: 0.25, width: 1, height: 0.5 }, 0.5)
    // cropAspect = (1 / 0.5) * 0.5 = 1.0
    expect(style?.containerStyle.aspectRatio).toBe('1')
  })
})
