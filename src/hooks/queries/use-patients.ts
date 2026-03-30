import { useQuery } from '@tanstack/react-query'

export function usePatients(search?: string, page = 1, limit = 20, responsibleUserId?: string) {
  return useQuery({
    queryKey: ['patients', { search, page, limit, responsibleUserId }],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      params.set('page', String(page))
      params.set('limit', String(limit))
      if (responsibleUserId) params.set('responsibleUserId', responsibleUserId)
      const res = await fetch(`/api/patients?${params}`)
      if (!res.ok) throw new Error('Failed to fetch patients')
      return res.json()
    },
  })
}

export function usePatient(id: string | undefined) {
  return useQuery({
    queryKey: ['patients', id],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${id}`)
      if (!res.ok) throw new Error('Failed to fetch patient')
      return res.json()
    },
    enabled: !!id,
  })
}

export function usePatientTimeline(patientId: string | undefined) {
  return useQuery({
    queryKey: ['patients', patientId, 'timeline'],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/timeline`)
      if (!res.ok) throw new Error('Failed to fetch patient timeline')
      return res.json()
    },
    enabled: !!patientId,
  })
}
