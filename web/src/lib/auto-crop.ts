'use client'

import { detectFace } from './face-detection'
import { computeAutoCrop } from './face-alignment'
import type { PhotoCropData } from '@/validations/photo-crop'

export async function autoDetectAndSaveCrop(
  imageSource: string | HTMLImageElement,
  photoId: string,
): Promise<PhotoCropData | null> {
  let img: HTMLImageElement

  if (typeof imageSource === 'string') {
    img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = imageSource
    })
  } else {
    img = imageSource
  }

  const detection = await detectFace(img)
  if (!detection) return null

  const crop = computeAutoCrop(detection, '3:4', {
    width: img.naturalWidth,
    height: img.naturalHeight,
  })
  const cropBox: PhotoCropData = {
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    rotation: 0,
    aspect: '3:4',
    landmarks: detection.landmarks,
  }

  const res = await fetch(`/api/photos/${photoId}/crop`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cropBox }),
  })

  if (!res.ok) return null
  return cropBox
}
