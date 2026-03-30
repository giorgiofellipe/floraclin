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

export function useProducts(options?: { activeOnly?: boolean; diagramOnly?: boolean }) {
  const filter = options?.diagramOnly ? 'diagram' : options?.activeOnly ? 'active' : 'all'
  return useQuery({
    queryKey: queryKeys.products.list(filter),
    queryFn: () => fetchJson(`/api/products?filter=${filter}`),
  })
}

export function useDiagramProducts() {
  return useProducts({ activeOnly: true, diagramOnly: true })
}

export function useAllProducts() {
  return useQuery({
    queryKey: queryKeys.products.list('all'),
    queryFn: () => fetchJson('/api/products?filter=all'),
  })
}
