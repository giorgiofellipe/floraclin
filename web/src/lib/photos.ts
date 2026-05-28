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
 * inside a fixed-aspect container. The image overflows the container in the
 * un-cropped dimension and is positioned/scaled so the crop region fills it.
 */
export function applyCrop(crop: CropBox | null, sourceAspect: number): CroppedDisplayStyle | null {
  if (!crop) return null
  const cropAspect = (crop.width / crop.height) * sourceAspect
  // Scale so the cropped region fills the container; translate so the crop's top-left aligns.
  const scaleX = 1 / crop.width
  const scaleY = 1 / crop.height
  return {
    containerStyle: { aspectRatio: `${cropAspect}` },
    imageStyle: {
      width: `${scaleX * 100}%`,
      height: `${scaleY * 100}%`,
      objectFit: 'cover',
      objectPosition: 'top left',
      transform: `translate(${-crop.x * 100 * scaleX}%, ${-crop.y * 100 * scaleY}%)`,
    },
  }
}
