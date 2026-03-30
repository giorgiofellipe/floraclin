import { useQuery } from '@tanstack/react-query'

export function useConsentTemplates() {
  return useQuery({
    queryKey: ['consent', 'templates'],
    queryFn: async () => {
      const res = await fetch('/api/consent/templates')
      if (!res.ok) throw new Error('Failed to fetch consent templates')
      return res.json()
    },
  })
}

export function useConsentHistory(patientId: string | undefined) {
  return useQuery({
    queryKey: ['consent', 'history', patientId],
    queryFn: async () => {
      const res = await fetch(`/api/consent/history/${patientId}`)
      if (!res.ok) throw new Error('Failed to fetch consent history')
      return res.json()
    },
    enabled: !!patientId,
  })
}
