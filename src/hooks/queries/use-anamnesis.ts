import { useQuery } from '@tanstack/react-query'

export function useAnamnesis(patientId: string | undefined) {
  return useQuery({
    queryKey: ['anamnesis', patientId],
    queryFn: async () => {
      const res = await fetch(`/api/anamnesis/${patientId}`)
      if (!res.ok) throw new Error('Failed to fetch anamnesis')
      return res.json()
    },
    enabled: !!patientId,
  })
}
