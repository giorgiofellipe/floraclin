'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CropBox } from '@/validations/photo'

export interface UpdatePhotoCropInput {
  photoId: string
  cropBox: CropBox | null
  cropAspect: number | null
}

/**
 * PATCH /api/photos/:id — persists a non-destructive crop (or clears it).
 *
 * `cropBox` and `cropAspect` are sent together. Pass both `null` to remove
 * the crop. The server validates that they agree.
 */
export function useUpdatePhotoCrop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ photoId, cropBox, cropAspect }: UpdatePhotoCropInput) => {
      const res = await fetch(`/api/photos/${photoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cropBox, cropAspect }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Falha ao salvar recorte (${res.status})`)
      }
      return res.json() as Promise<{ success: boolean; data: unknown }>
    },
    onSettled: () => {
      // Photo list reads run through arbitrary keys; invalidate the broad
      // photos namespace plus the patient timeline for thumbnails that may
      // surface elsewhere.
      qc.invalidateQueries({ queryKey: ['photos'] })
    },
  })
}
