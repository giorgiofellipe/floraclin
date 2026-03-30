import { useQuery } from '@tanstack/react-query'

export function useEvaluationTemplates(typeIds: string[]) {
  return useQuery({
    queryKey: ['evaluation', 'templates', typeIds],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('typeIds', typeIds.join(','))
      const res = await fetch(`/api/evaluation/templates?${params}`)
      if (!res.ok) throw new Error('Failed to fetch evaluation templates')
      return res.json()
    },
    enabled: typeIds.length > 0,
  })
}

export function useEvaluationResponses(procedureId: string | undefined) {
  return useQuery({
    queryKey: ['evaluation', 'responses', procedureId],
    queryFn: async () => {
      const res = await fetch(`/api/evaluation/responses/${procedureId}`)
      if (!res.ok) throw new Error('Failed to fetch evaluation responses')
      return res.json()
    },
    enabled: !!procedureId,
  })
}
