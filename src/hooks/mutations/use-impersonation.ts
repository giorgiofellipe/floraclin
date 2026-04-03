'use client'

import { useMutation } from '@tanstack/react-query'

async function mutateJson(url: string, method: string, data?: unknown) {
  const res = await fetch(url, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useImpersonate() {
  return useMutation({
    mutationFn: ({ tenantId }: { tenantId: string }) =>
      mutateJson('/api/admin/impersonate', 'POST', { tenantId }),
    onSuccess: () => {
      window.location.reload()
    },
  })
}

export function useClearImpersonation() {
  return useMutation({
    mutationFn: () => mutateJson('/api/admin/impersonate/clear', 'POST'),
    onSuccess: () => {
      window.location.reload()
    },
  })
}
