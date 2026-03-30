import { useQuery } from '@tanstack/react-query'

export function useProcedureTypes() {
  return useQuery({
    queryKey: ['procedure-types'],
    queryFn: async () => {
      const res = await fetch('/api/procedure-types')
      if (!res.ok) throw new Error('Failed to fetch procedure types')
      return res.json()
    },
  })
}
