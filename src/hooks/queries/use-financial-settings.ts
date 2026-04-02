'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'

export function useFinancialSettings() {
  return useQuery({
    queryKey: queryKeys.financial.settings,
    queryFn: async () => {
      const res = await fetch('/api/financial/settings')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar configurações financeiras')
      }
      return res.json()
    },
  })
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: queryKeys.financial.categories,
    queryFn: async () => {
      const res = await fetch('/api/financial/settings/categories')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar categorias de despesa')
      }
      return res.json()
    },
  })
}
