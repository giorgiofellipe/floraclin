'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

async function fetchJson(url: string) {
  const res = await fetch(url)
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useTenant() {
  return useQuery({
    queryKey: queryKeys.tenant.detail,
    queryFn: () => fetchJson('/api/tenant'),
  })
}

export function useTenantUsers() {
  return useQuery({
    queryKey: queryKeys.tenant.users,
    queryFn: () => fetchJson('/api/tenant/users'),
  })
}
