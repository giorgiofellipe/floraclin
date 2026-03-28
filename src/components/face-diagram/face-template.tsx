'use client'

import Image from 'next/image'
import type { DiagramViewType } from '@/types'

const VIEW_LABELS: Record<DiagramViewType, string> = {
  front: 'Frontal',
  left_profile: 'Perfil Esquerdo',
  right_profile: 'Perfil Direito',
}

const VIEW_FILES: Record<DiagramViewType, string> = {
  front: '/face-templates/front.svg',
  left_profile: '/face-templates/left-profile.svg',
  right_profile: '/face-templates/right-profile.svg',
}

interface FaceTemplateProps {
  viewType: DiagramViewType
  className?: string
}

export function FaceTemplate({ viewType, className }: FaceTemplateProps) {
  return (
    <Image
      src={VIEW_FILES[viewType]}
      alt={VIEW_LABELS[viewType]}
      fill
      className={className}
      style={{ objectFit: 'contain' }}
      priority
      draggable={false}
    />
  )
}

export { VIEW_LABELS, VIEW_FILES }
