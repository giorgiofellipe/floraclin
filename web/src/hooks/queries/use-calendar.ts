'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { CalendarBlockRow } from '@/db/queries/calendar'

export function useCalendarBlocks(
  practitionerId: string | undefined,
  dateFrom: string,
  dateTo: string
) {
  return useQuery<CalendarBlockRow[]>({
    queryKey: queryKeys.calendar.blocks(practitionerId, dateFrom, dateTo),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (practitionerId) params.set('practitionerId', practitionerId)
      params.set('dateFrom', dateFrom)
      params.set('dateTo', dateTo)
      const res = await fetch(`/api/calendar/blocks?${params}`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
  })
}

export function useCalendarConnections() {
  return useQuery({
    queryKey: queryKeys.calendar.connections,
    queryFn: async () => {
      const res = await fetch('/api/calendar/connections')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
  })
}
