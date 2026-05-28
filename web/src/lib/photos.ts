import type { CropBox } from '@/validations/photo'

export interface CroppedDisplayStyle {
  /**
   * Style for an inner wrapper that takes the **crop's** aspect ratio and
   * fits inside whatever host the consumer provides (letterbox via
   * `max-width: 100%` + `max-height: 100%`). The host should center this
   * wrapper — see `CROP_HOST_CLASS` below for a ready-made class string.
   */
  wrapperStyle: {
    aspectRatio: string
    maxWidth: '100%'
    maxHeight: '100%'
  }
  /**
   * Style for the `<img>` element that lives inside the wrapper. Renders the
   * image at `1/crop.width` × `1/crop.height` of the wrapper (so the crop
   * region's pixels span it) and translates so the crop's top-left aligns
   * with the wrapper's top-left.
   */
  imageStyle: {
    width: string
    height: string
    objectFit: 'cover'
    objectPosition: 'top left'
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
  const scaleY = 1 / crop.height
  return {
    wrapperStyle: {
      aspectRatio: `${cropAspect}`,
      maxWidth: '100%',
      maxHeight: '100%',
    },
    imageStyle: {
      width: `${scaleX * 100}%`,
      height: `${scaleY * 100}%`,
      objectFit: 'cover',
      objectPosition: 'top left',
      transform: `translate(${-crop.x * 100}%, ${-crop.y * 100}%)`,
    },
  }
}
