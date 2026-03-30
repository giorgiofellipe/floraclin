'use client'

import { useQuery } from '@tanstack/react-query'
import {
  listActiveProductsAction,
  listDiagramProductsAction,
  listAllProductsAction,
} from '@/actions/products-catalog'

export function useProducts(options?: { activeOnly?: boolean; diagramOnly?: boolean }) {
  return useQuery({
    queryKey: ['products', options],
    queryFn: () => {
      if (options?.diagramOnly) return listDiagramProductsAction()
      if (options?.activeOnly) return listActiveProductsAction()
      return listAllProductsAction()
    },
  })
}

export function useDiagramProducts() {
  return useProducts({ activeOnly: true, diagramOnly: true })
}

export function useAllProducts() {
  return useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => listAllProductsAction(),
  })
}
