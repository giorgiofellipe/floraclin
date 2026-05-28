import type { CropBox } from '@/validations/photo'

export interface CroppedDisplayStyle {
  /**
   * Style for an inner wrapper that takes the **crop's** aspect ratio and
   * fits inside whatever host the consumer provides.
   *
   * Why these specific properties:
   *  - `aspectRatio` shapes the wrapper to match the crop.
   *  - `width: 100%` gives the wrapper a concrete starting size (without it,
   *    the inner image's percentage-based width/height creates a chicken-
   *    and-egg with no resolvable dimensions, and the browser falls back to
   *    the image's natural pixel size — overflowing the host).
   *  - `maxHeight: 100%` lets the host clamp letterboxing when the crop is
   *    taller than the host; modern browsers re-derive the wrapper width
   *    via aspect-ratio after the clamp.
   */
  wrapperStyle: {
    aspectRatio: string
    width: '100%'
    maxHeight: '100%'
  }
  /**
   * Style for the `<img>` element that lives inside the wrapper.
   *
   * The image is sized by `width: 1/crop.width * 100%` of the wrapper. Height
   * is left as `auto` so the browser preserves the image's natural aspect
   * ratio — setting an explicit height (e.g. `scaleY * 100%`) forces the
   * browser to stretch the image to the wrapper's aspect, which is the bug
   * the user kept hitting ("changes the aspect ratio, displays the img way
   * bigger").
   *
   * The translate then shifts the natural-aspect image so the crop's top-
   * left pixel aligns with the wrapper's top-left.
   */
  imageStyle: {
    width: string
    height: 'auto'
    transform: string
  }
}

/**
 * Tailwind utilities for the host element that wraps a `<CroppedDisplay>`.
 * Use this on the consumer side so a crop fits any shape host (grid card,
 * comparison column, dialog) without overriding the wrapper's aspect ratio.
 *
 * Example:
 * ```tsx
 * <div className={`relative aspect-[3/4] ${CROP_HOST_CLASS}`}>
 *   <div style={cropStyle.wrapperStyle}>
 *     <img style={cropStyle.imageStyle} />
 *   </div>
 * </div>
 * ```
 */
export const CROP_HOST_CLASS = 'flex items-center justify-center overflow-hidden'

/**
 * Converts a normalized crop box to CSS that renders the cropped region.
 *
 * The image is rendered at `1/crop.width` × `1/crop.height` of the wrapper
 * (so the crop region's pixels span the full wrapper) and then translated so
 * the crop's top-left aligns with the wrapper's top-left.
 *
 * CSS subtleties:
 *  - The wrapper carries `aspect-ratio: cropAspect` PLUS `max-width: 100%`
 *    and `max-height: 100%`. The host MUST NOT also force the wrapper to a
 *    different size (e.g., `h-full w-full`) — that overrides the aspect rule
 *    and stretches the image to a wrong shape. Use `CROP_HOST_CLASS` to
 *    center the wrapper inside any host.
 *  - Percentages on `transform: translate(...)` are relative to the element's
 *    own bounding box. The natural-image pixel at fraction `crop.x` lies at
 *    `crop.x * imageWidth` from the image's left edge, so we shift by
 *    `-crop.x * 100%` of the image (NOT scaled by `1/crop.width` — the
 *    percentage already accounts for the rendered image size).
 */
export function applyCrop(crop: CropBox | null, sourceAspect: number): CroppedDisplayStyle | null {
  if (!crop) return null
  const cropAspect = (crop.width / crop.height) * sourceAspect
  const scaleX = 1 / crop.width
  return {
    wrapperStyle: {
      aspectRatio: `${cropAspect}`,
      width: '100%',
      maxHeight: '100%',
    },
    imageStyle: {
      width: `${scaleX * 100}%`,
      height: 'auto',
      transform: `translate(${-crop.x * 100}%, ${-crop.y * 100}%)`,
    },
  }
}
