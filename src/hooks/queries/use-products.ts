import { useQuery } from '@tanstack/react-query'

export function useProducts(options?: { activeOnly?: boolean; diagramOnly?: boolean }) {
  return useQuery({
    queryKey: ['products', options],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (options?.activeOnly) params.set('activeOnly', 'true')
      if (options?.diagramOnly) params.set('diagramOnly', 'true')
      const res = await fetch(`/api/products?${params}`)
      if (!res.ok) throw new Error('Failed to fetch products')
      return res.json()
    },
  })
}

export function useDiagramProducts() {
  return useProducts({ activeOnly: true, diagramOnly: true })
}

export function useAllProducts() {
  return useQuery({
    queryKey: ['products', 'all'],
    queryFn: async () => {
      const res = await fetch('/api/products/all')
      if (!res.ok) throw new Error('Failed to fetch all products')
      return res.json()
    },
  })
}
