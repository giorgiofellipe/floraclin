/**
 * Face-template metadata — view labels, asset paths, and gender resolution —
 * deliberately kept in a plain module, separate from `face-template.tsx`.
 *
 * `face-template.tsx` is `'use client'`. In the App Router, when server code
 * imports from a `'use client'` module, Next does not give it the real
 * values: every export is replaced by a client *reference* stub. Reading a
 * property off one throws `Cannot access VIEW_LABELS.front on the server.
 * You cannot dot into a client module from a server component`, and calling
 * one throws `Attempted to call resolveGenderKey() from the server`. Neither
 * is catchable by a `??` fallback — the proxy throws on access itself.
 *
 * The prontuário PDF (`@/components/reports/prontuario-pdf`) renders inside a
 * route handler, i.e. on the server, and needs these values for real. So they
 * live here, where both sides can import them safely.
 *
 * Keep this file free of `'use client'`, of React, and of `next/image` —
 * anything that would force it back into the client graph.
 */
import type { DiagramViewType } from '@/types'

export const VIEW_LABELS: Record<DiagramViewType, string> = {
  front: 'Frontal',
  left_profile: 'Perfil Esquerdo',
  right_profile: 'Perfil Direito',
}

export type Gender = 'masculino' | 'feminino' | string | null | undefined

export const VIEW_FILES: Record<string, Record<DiagramViewType, string>> = {
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

export function resolveGenderKey(gender: Gender): 'female' | 'male' {
  if (!gender) return 'female'
  const g = gender.toLowerCase().trim()
  if (g === 'masculino' || g === 'male' || g === 'm') return 'male'
  return 'female'
}
