import { useQuery } from '@tanstack/react-query'

export function useProcedures(patientId: string | undefined) {
  return useQuery({
    queryKey: ['procedures', { patientId }],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('patientId', patientId!)
      const res = await fetch(`/api/procedures?${params}`)
      if (!res.ok) throw new Error('Failed to fetch procedures')
      return res.json()
    },
    enabled: !!patientId,
  })
}

export function useProcedure(id: string | undefined) {
  return useQuery({
    queryKey: ['procedures', id],
    queryFn: async () => {
      const res = await fetch(`/api/procedures/${id}`)
      if (!res.ok) throw new Error('Failed to fetch procedure')
      return res.json()
    },
    enabled: !!id,
  })
}
