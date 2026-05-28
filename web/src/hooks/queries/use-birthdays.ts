'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface BirthdayItem {
  id: string
  fullName: string
  birthDate: string
  phone: string
  ageTurning: number
  greetedAt: string | null
  greetedByName: string | null
}

/**
 * Fetch patients with birthdays in a BR-local YYYY-MM-DD window.
 * Both `from` and `to` are inclusive and host-TZ-safe — the API uses
 * `EXTRACT(MONTH/DAY)` so we don't ever convert birth dates to instants.
 */
export function useBirthdays(args: { from: string; to: string; enabled?: boolean }) {
  return useQuery({
    queryKey: ['birthdays', args.from, args.to],
    enabled: args.enabled ?? true,
    queryFn: async (): Promise<BirthdayItem[]> => {
      const params = new URLSearchParams({ from: args.from, to: args.to })
      const res = await fetch(`/api/birthdays?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao carregar aniversariantes')
      }
      const json = await res.json()
      return json.data as BirthdayItem[]
    },
  })
}

/**
 * Toggle the "greeted this year" flag for a patient.
 * `greeted: true` → POST (record greeting). `greeted: false` → DELETE (clear it).
 */
export function useToggleGreeting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { patientId: string; greeted: boolean; year: number }) => {
      const url = `/api/birthdays/${args.patientId}/greeting`
      const init: RequestInit = args.greeted
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year: args.year }),
          }
        : {
            method: 'DELETE',
          }
      const finalUrl = args.greeted ? url : `${url}?year=${args.year}`
      const res = await fetch(args.greeted ? url : finalUrl, init)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Não foi possível atualizar o status')
      }
      return res.json().catch(() => ({}))
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['birthdays'] })
    },
  })
}
