'use client'

import Image from 'next/image'
import type { DiagramViewType } from '@/types'

const VIEW_LABELS: Record<DiagramViewType, string> = {
  front: 'Frontal',
  left_profile: 'Perfil Esquerdo',
  right_profile: 'Perfil Direito',
}

type Gender = 'masculino' | 'feminino' | string | null | undefined

const VIEW_FILES: Record<string, Record<DiagramViewType, string>> = {
  female: {
    front: '/face-templates/female-front.webp',
    left_profile: '/face-templates/female-left.webp',
    right_profile: '/face-templates/female-right.webp',
  },
  male: {
    front: '/face-templates/male-front.webp',
    left_profile: '/face-templates/male-left.webp',
    right_profile: '/face-templates/male-right.webp',
  },
}

function resolveGenderKey(gender: Gender): 'female' | 'male' {
  if (!gender) return 'female'
  const g = gender.toLowerCase().trim()
  if (g === 'masculino' || g === 'male' || g === 'm') return 'male'
  return 'female'
}

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

export { VIEW_LABELS, VIEW_FILES }
