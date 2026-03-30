import { useQuery } from '@tanstack/react-query'

export function useDashboard(practitionerId?: string) {
  return useQuery({
    queryKey: ['dashboard', { practitionerId }],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (practitionerId) params.set('practitionerId', practitionerId)
      const res = await fetch(`/api/dashboard?${params}`)
      if (!res.ok) throw new Error('Failed to fetch dashboard data')
      return res.json()
    },
  })
}
