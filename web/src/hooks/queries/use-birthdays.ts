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

export interface BirthdayTemplate {
  name: string
  language: string
  status: string // PENDING | APPROVED | REJECTED | …
  variableMapping: Array<{ index: number; key: string; label: string }> | null
}

/**
 * Looks up the tenant's birthday-greeting template (the one with
 * `purposeKey = 'birthday_greeting'`). Used by the Aniversariantes screen to
 * enable the "Enviar mensagem" action only when an approved template exists
 * and WhatsApp is configured for the tenant.
 *
 * Returns `null` (not throws) when:
 *  - WhatsApp is disabled for this tenant (`/api/whatsapp/templates` → 403)
 *  - No template with that purposeKey exists yet
 */
export function useBirthdayTemplate() {
  return useQuery<BirthdayTemplate | null>({
    queryKey: ['whatsapp-birthday-template'],
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch('/api/whatsapp/templates')
      if (res.status === 403) return null // WhatsApp disabled
      if (!res.ok) return null
      const json = await res.json()
      const templates = (json.data ?? json) as Array<{
        name: string
        language: string
        status: string
        purposeKey: string | null
        variableMapping: BirthdayTemplate['variableMapping']
      }>
      const found = templates.find((t) => t.purposeKey === 'birthday_greeting')
      if (!found) return null
      return {
        name: found.name,
        language: found.language,
        status: found.status,
        variableMapping: found.variableMapping ?? null,
      }
    },
  })
}

/**
 * Sends the birthday-greeting WhatsApp template to a patient. On success the
 * caller is responsible for invalidating the birthdays list — typically by
 * pairing this with `useToggleGreeting` to auto-mark the patient as greeted.
 */
export function useSendBirthdayMessage() {
  return useMutation({
    mutationFn: async (args: {
      patientId: string
      templateName: string
      language: string
      params: Record<string, string>
    }) => {
      const res = await fetch('/api/whatsapp/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: args.patientId,
          templateName: args.templateName,
          language: args.language,
          params: args.params,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao enviar mensagem')
      }
      return res.json()
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
