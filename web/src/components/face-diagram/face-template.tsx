'use client'

import Image from 'next/image'
import type { DiagramViewType } from '@/types'
import { VIEW_FILES, VIEW_LABELS, resolveGenderKey, type Gender } from './face-template-data'

// The labels, asset paths and gender resolution deliberately live in
// `./face-template-data` and are NOT re-exported from here. Server code
// (the prontuário PDF) needs them, and re-exporting through this
// `'use client'` module would hand the server a client-reference stub that
// throws on access. Import them from `./face-template-data` directly.

interface FaceTemplateProps {
  viewType: DiagramViewType
  gender?: Gender
  className?: string
}

export function FaceTemplate({ viewType, gender, className }: FaceTemplateProps) {
  const genderKey = resolveGenderKey(gender)
  const src = VIEW_FILES[genderKey][viewType]

  return (
    <Image
      src={src}
      alt={VIEW_LABELS[viewType]}
      fill
      className={className}
      style={{ objectFit: 'contain' }}
      priority
      draggable={false}
    />
  )
}
