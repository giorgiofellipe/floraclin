import type { CropBox } from '@/validations/photo'

export interface CroppedDisplayStyle {
  /**
   * Style for an inner wrapper that takes the **crop's** aspect ratio.
   *
   * IMPORTANT: do NOT add explicit width (`w-full`, `style.width`) at the
   * consumer side. The wrapper relies on `aspect-ratio` + `max-width` +
   * `max-height` working together, which only happens when at least one
   * axis is auto. With an explicit width pinned, the browser can't
   * re-derive width when max-height clamps the height — the wrapper ends
   * up at the wrong aspect and the inner img overflows.
   *
   * Caller passes a `maxHeight` CSS string (e.g. `'70vh'`) and the wrapper
   * gets `max-width: calc(maxHeight * cropAspect)` so the wrapper never
   * exceeds the requested height. Block default sizing fills the parent
   * width, then max-width caps it; aspect-ratio derives height.
   */
  wrapperStyle: {
    aspectRatio: string
    maxWidth: string
    maxHeight: string
    overflow: 'hidden'
    position: 'relative'
  }
  /**
   * Style for the `<img>` element that lives inside the wrapper.
   *
   * The image is sized by `width: 1/crop.width * 100%` of the wrapper, with
   * `height: auto` so the browser preserves natural aspect. The translate
   * then shifts the natural-aspect image so the crop's top-left pixel
   * aligns with the wrapper's top-left.
   */
  imageStyle: {
    display: 'block'
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
export interface ApplyCropOptions {
  /**
   * CSS length capping the wrapper's height (e.g. `'70vh'`). The wrapper's
   * `max-width` is internally set to `calc(maxHeight * cropAspect)` so the
   * letterboxed wrapper never exceeds the requested height even at very
   * wide hosts. Omit when the host already constrains height directly.
   */
  maxHeight?: string
}

export function applyCrop(
  crop: CropBox | null,
  sourceAspect: number,
  opts: ApplyCropOptions = {},
): CroppedDisplayStyle | null {
  if (!crop) return null
  const cropAspect = (crop.width / crop.height) * sourceAspect
  const scaleX = 1 / crop.width
  const maxHeight = opts.maxHeight ?? '100%'
  const maxWidth = opts.maxHeight
    ? `calc(${opts.maxHeight} * ${cropAspect})`
    : '100%'
  return {
    wrapperStyle: {
      aspectRatio: `${cropAspect}`,
      maxWidth,
      maxHeight,
      overflow: 'hidden',
      position: 'relative',
    },
    imageStyle: {
      display: 'block',
      width: `${scaleX * 100}%`,
      height: 'auto',
      transform: `translate(${-crop.x * 100}%, ${-crop.y * 100}%)`,
    },
  }
}

export interface CroppedCoverStyle {
  /**
   * Style for the wrapper. Sized to AT LEAST the host's dimensions in both
   * directions (object-cover semantics) so the crop fills the host
   * uniformly. The wrapper is absolutely positioned and centered so the
   * clip from `overflow: hidden` on the host is symmetric.
   *
   * Uses CSS `aspect-ratio` (not padding-bottom) because here BOTH bounds
   * are MIN constraints — neither width nor height is explicit, so modern
   * browsers can resolve aspect-ratio + min-width + min-height without the
   * "explicit-width-pins-the-clamp" problem the letterbox variant has to
   * dodge.
   */
  wrapperStyle: {
    position: 'absolute'
    top: '50%'
    left: '50%'
    transform: 'translate(-50%, -50%)'
    aspectRatio: string
    minWidth: '100%'
    minHeight: '100%'
  }
  /** Same image style as `applyCrop` — absolute, `width = 1/crop.width`, natural height. */
  imageStyle: {
    position: 'absolute'
    top: 0
    left: 0
    width: string
    height: 'auto'
    transform: string
  }
}

/**
 * Object-cover variant of `applyCrop`. Use this when the host has a fixed
 * shape (e.g., a grid card with `aspect-[3/4]`) and you want the crop to
 * fill it without letterbox bars. The host must be `relative` and have
 * `overflow: hidden`.
 */
export function applyCropCover(crop: CropBox | null, sourceAspect: number): CroppedCoverStyle | null {
  if (!crop) return null
  const cropAspect = (crop.width / crop.height) * sourceAspect
  const scaleX = 1 / crop.width
  return {
    wrapperStyle: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      aspectRatio: `${cropAspect}`,
      minWidth: '100%',
      minHeight: '100%',
    },
    imageStyle: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: `${scaleX * 100}%`,
      height: 'auto',
      transform: `translate(${-crop.x * 100}%, ${-crop.y * 100}%)`,
    },
  }
}
