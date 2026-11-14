'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { queryKeys } from '@/hooks/queries/query-keys'
import { useTenant } from '@/hooks/queries/use-tenant'
import { mutateJson } from '@/hooks/mutations/use-appointment-mutations'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'
import { canSendRescheduleNotice } from '@/validations/appointment'
import { brToday, parseLocalDate } from '@/lib/dates'
import { RESCHEDULE_NOTICE_SENT, RESCHEDULE_NOTICE_TOASTS } from '@/lib/reschedule-notice-copy'
import type { RescheduleNotification } from '@/lib/whatsapp-reschedule'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

export interface Slot {
  date: string
  startTime: string
  endTime: string
}

type Snapshot = [readonly unknown[], AppointmentWithDetails[] | undefined][]

interface MoveResponse {
  data: { updatedAt: string }
  notification?: RescheduleNotification
  /** The confirmation state the move reset; sent back on undo. */
  previous: { status: string; confirmedAt: string | null; confirmationSentAt: string | null; confirmationMessageId: string | null }
}

interface MoveVars {
  appointment: AppointmentWithDetails
  slot: Slot
  notifyPatient: boolean
  undo?: { expectedUpdatedAt: string; restore: MoveResponse['previous'] }
}

const MOVED_TOAST_MS = 6000
// Long enough to read the toast and still reach "Avisar por WhatsApp".
const MOVED_WITH_NOTICE_TOAST_MS = 10000

function showNotification(notification: RescheduleNotification | undefined) {
  if (notification === 'sent') toast.success(RESCHEDULE_NOTICE_SENT)
  else if (notification) toast.warning(RESCHEDULE_NOTICE_TOASTS[notification])
}

export function slotLabel(slot: Pick<Slot, 'date' | 'startTime'>): string {
  return `${format(parseLocalDate(slot.date, '12:00:00'), 'EEE, d/MM', { locale: ptBR })} às ${slot.startTime.slice(0, 5)}`
}

/**
 * Moves an appointment to a new slot: the agenda shows it there at once, the
 * server still checks conflicts and blocks, and a refusal puts it back.
 */
export function useMoveAppointment() {
  const queryClient = useQueryClient()
  const { data: tenant } = useTenant()
  // One move per appointment at a time: a second drag before the first save returns could land first
  // and then be overwritten by the older request.
  const [movingIds, setMovingIds] = useState<ReadonlySet<string>>(new Set())
  const setMoving = (id: string, moving: boolean) =>
    setMovingIds((prev) => {
      const next = new Set(prev)
      if (moving) next.add(id)
      else next.delete(id)
      return next
    })

  const mutation = useMutation({
    mutationFn: ({ appointment, slot, notifyPatient, undo }: MoveVars) =>
      mutateJson(`/api/appointments/${appointment.id}`, 'PUT', { ...slot, notifyPatient, ...undo }) as Promise<MoveResponse>,
    onMutate: async ({ appointment, slot }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.appointments.lists })
      const snapshot = queryClient.getQueriesData<AppointmentWithDetails[]>({ queryKey: queryKeys.appointments.lists }) as Snapshot
      queryClient.setQueriesData<AppointmentWithDetails[]>({ queryKey: queryKeys.appointments.lists }, (rows) =>
        Array.isArray(rows) ? rows.map((row) => (row.id === appointment.id ? { ...row, ...slot } : row)) : rows,
      )
      return { snapshot }
    },
    onError: (err, _vars, context) => {
      for (const [key, rows] of context?.snapshot ?? []) queryClient.setQueryData(key, rows)
      toast.error(err.message)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })

  /** Whether moving `appointment` to `date` may send the patient a WhatsApp notice. */
  const canNotify = (appointment: Pick<AppointmentWithDetails, 'status'>, date: string) =>
    isWhatsAppEnabled(tenant?.settings) && canSendRescheduleNotice(appointment.status, date, brToday())

  async function sendNotice(appointmentId: string): Promise<boolean> {
    try {
      const body = (await mutateJson(`/api/appointments/${appointmentId}/reschedule-notice`, 'POST')) as { notification?: RescheduleNotification }
      if (body.notification === 'sent') return true
      showNotification(body.notification)
      return false
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível avisar o paciente.')
      return false
    }
  }

  /**
   * One request that puts the old slot and the confirmation state back, refused by the server if
   * anyone changed the appointment since. A patient already told about the move hears about the undo.
   */
  async function undo(appointment: AppointmentWithDetails, moved: Slot, to: Slot, response: MoveResponse, patientWasTold: boolean) {
    try {
      await mutation.mutateAsync({
        appointment: { ...appointment, ...moved },
        slot: to,
        notifyPatient: patientWasTold,
        undo: { expectedUpdatedAt: response.data.updatedAt, restore: response.previous },
      })
    } catch {
      return // onError already rolled back and said why
    }
    toast.success(patientWasTold ? 'Reagendamento desfeito. Paciente avisado do horário original.' : 'Reagendamento desfeito')
  }

  /**
   * `notifyPatient` sends the WhatsApp notice with the move (reschedule picker).
   * Without it, the success toast offers the notice afterwards (drag).
   */
  async function move(appointment: AppointmentWithDetails, slot: Slot, { notifyPatient = false }: { notifyPatient?: boolean } = {}) {
    const previous: Slot = {
      date: appointment.date,
      startTime: appointment.startTime.slice(0, 5),
      endTime: appointment.endTime.slice(0, 5),
    }
    const allowed = canNotify(appointment, slot.date)
    const offerNotice = !notifyPatient && allowed
    // mutateAsync, not mutate(..., callbacks): per-call callbacks only run for the latest call, so a
    // second quick drag would drop the first one's toast and undo.
    let result: MoveResponse
    setMoving(appointment.id, true)
    try {
      result = await mutation.mutateAsync({ appointment, slot, notifyPatient: notifyPatient && allowed })
    } catch {
      return
    } finally {
      setMoving(appointment.id, false)
    }
    showNotification(result.notification)
    let patientWasTold = result.notification === 'sent'
    const name = appointment.patientName ?? appointment.bookingName ?? 'Agendamento'
    const title = `Reagendado: ${name}, ${slotLabel(slot)}`
    const action = { label: 'Desfazer', onClick: () => void undo(appointment, slot, previous, result, patientWasTold) }
    const id = toast.success(title, {
      duration: offerNotice ? MOVED_WITH_NOTICE_TOAST_MS : MOVED_TOAST_MS,
      description: offerNotice ? (
        <button
          type="button"
          className="mt-1 min-h-9 font-medium text-forest underline underline-offset-2"
          onClick={async () => {
            if (!(await sendNotice(appointment.id))) return
            patientWasTold = true
            // Same toast, so "Desfazer" stays in reach after the notice.
            toast.success(title, { id, description: 'Paciente avisado por WhatsApp.', duration: MOVED_TOAST_MS, action })
          }}
        >
          Avisar por WhatsApp
        </button>
      ) : undefined,
      action,
    })
  }

  return { move, canNotify, isMoving: (id: string) => movingIds.has(id) }
}
