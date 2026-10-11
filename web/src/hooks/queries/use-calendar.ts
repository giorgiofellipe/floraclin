'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './query-keys'
import type { CalendarBlockRow } from '@/db/queries/calendar'
import type { CreateCalendarBlockInput } from '@/validations/calendar-block'

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

export function useCreateCalendarBlock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateCalendarBlockInput) => {
      const res = await fetch('/api/calendar/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao bloquear horário')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
    },
  })
}

export function useDeleteCalendarBlock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (blockId: string) => {
      const res = await fetch(`/api/calendar/blocks/${blockId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao remover bloqueio')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
    },
  })
}
