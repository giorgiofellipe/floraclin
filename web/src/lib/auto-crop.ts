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

  const rawDetection = await detectFace(img)
  // Reject false positives: IPD threshold is yaw-aware because profile
  // photos foreshorten the eye distance significantly.
  const absYaw = rawDetection ? Math.abs(rawDetection.rotation.yaw) : 0
  const MIN_IPD = absYaw > 40 ? 0.02 : 0.05
  const detection = rawDetection && rawDetection.landmarks.interPupillaryDistance >= MIN_IPD ? rawDetection : null
  if (!detection && rawDetection) {
    console.warn('[auto-crop] Face detection rejected — IPD too small:', rawDetection.landmarks.interPupillaryDistance.toFixed(4), '(min:', MIN_IPD, ') — using center crop fallback')
  } else if (!detection) {
    console.warn('[auto-crop] Face detection failed — using center crop fallback')
  } else {
    console.info('[auto-crop] Face detected, yaw:', detection.rotation.yaw.toFixed(1), 'ipd:', detection.landmarks.interPupillaryDistance.toFixed(3))
  }

  let cropBox: PhotoCropData

  if (detection) {
    const crop = computeAutoCrop(detection, '3:4', {
      width: img.naturalWidth,
      height: img.naturalHeight,
    })
    cropBox = {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
      rotation: 0,
      aspect: '3:4',
      landmarks: detection.landmarks,
    }
  } else {
    const imgAspect = img.naturalWidth / img.naturalHeight
    const cropAspect = 3 / 4
    let w: number, h: number
    if (imgAspect > cropAspect) {
      h = 1
      w = (cropAspect / imgAspect)
    } else {
      w = 1
      h = (imgAspect / cropAspect)
    }
    cropBox = {
      x: (1 - w) / 2,
      y: (1 - h) / 2,
      width: w,
      height: h,
      rotation: 0,
      aspect: '3:4',
    }
  }

  const res = await fetch(`/api/photos/${photoId}/crop`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cropBox }),
  })

  if (!res.ok) return null
  return cropBox
}
