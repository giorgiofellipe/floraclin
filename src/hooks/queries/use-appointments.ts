import { useQuery } from '@tanstack/react-query'

export function useAppointments(
  dateFrom: string,
  dateTo: string,
  practitionerId?: string
) {
  return useQuery({
    queryKey: ['appointments', { dateFrom, dateTo, practitionerId }],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('dateFrom', dateFrom)
      params.set('dateTo', dateTo)
      if (practitionerId) params.set('practitionerId', practitionerId)
      const res = await fetch(`/api/appointments?${params}`)
      if (!res.ok) throw new Error('Failed to fetch appointments')
      return res.json()
    },
    enabled: !!dateFrom && !!dateTo,
  })
}

export function useAvailableSlots(
  practitionerId: string | undefined,
  date: string | undefined,
  durationMin = 30
) {
  return useQuery({
    queryKey: ['appointments', 'slots', { practitionerId, date, durationMin }],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('practitionerId', practitionerId!)
      params.set('date', date!)
      params.set('durationMin', String(durationMin))
      const res = await fetch(`/api/appointments/slots?${params}`)
      if (!res.ok) throw new Error('Failed to fetch available slots')
      return res.json()
    },
    enabled: !!practitionerId && !!date,
  })
}
