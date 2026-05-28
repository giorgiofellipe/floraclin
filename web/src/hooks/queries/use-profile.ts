'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface ProfileData {
  id: string
  fullName: string | null
  email: string | null
  phone: string | null
  signatureData: string | null
  signatureUpdatedAt: string | null
  professionalTitle: string | null
  registryType: string | null
  registryNumber: string | null
  registryState: string | null
}

const profileKey = ['profile'] as const

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useProfile() {
  return useQuery<{ data: ProfileData }>({
    queryKey: profileKey,
    queryFn: () => fetchJson('/api/profile'),
  })
}

export interface UpdateProfileInput {
  fullName?: string
  phone?: string | null
  signatureData?: string | null
  professionalTitle?: string | null
  registryType?: string | null
  registryNumber?: string | null
  registryState?: string | null
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      fetchJson('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKey })
    },
  })
}
