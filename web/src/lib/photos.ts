import type { CropBox } from '@/validations/photo'

export interface CroppedDisplayStyle {
  containerStyle: { aspectRatio: string }
  imageStyle: {
    width: string
    height: string
    objectFit: 'cover'
    objectPosition: string
    transform: string
  }
}

/**
 * Converts a normalized crop box to CSS that renders the cropped region
 * inside a fixed-aspect container.
 *
 * The image is rendered at `1/crop.width` × `1/crop.height` of the container
 * (so the crop region's pixels span the full container) and then translated
 * so the crop's top-left aligns with the container's top-left.
 *
 * CSS subtlety: percentage values on `transform: translate(...)` are relative
 * to the element's own bounding box. The natural-image pixel at fraction
 * `crop.x` lies at `crop.x * imageWidth` from the image's left edge, so we
 * shift by `-crop.x * 100%` of the image (NOT scaled by `1/crop.width` — the
 * percentage already accounts for the rendered image size).
 */
export function applyCrop(crop: CropBox | null, sourceAspect: number): CroppedDisplayStyle | null {
  if (!crop) return null
  const cropAspect = (crop.width / crop.height) * sourceAspect
  const scaleX = 1 / crop.width
  const scaleY = 1 / crop.height
  return {
    containerStyle: { aspectRatio: `${cropAspect}` },
    imageStyle: {
      width: `${scaleX * 100}%`,
      height: `${scaleY * 100}%`,
      objectFit: 'cover',
      objectPosition: 'top left',
      transform: `translate(${-crop.x * 100}%, ${-crop.y * 100}%)`,
    },
  }
}
