'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { appointmentDisplayName } from '@/components/scheduling/appointment-card'
import { queryKeys } from '@/hooks/queries/query-keys'
import { useMoveAppointment } from '@/hooks/mutations/use-move-appointment'
import { brToday, parseLocalDate } from '@/lib/dates'
import type { AppointmentWithDetails } from '@/db/queries/appointments'

interface FreeSlot {
  date: string
  start: string
  end: string
}

function useFreeSlots(appointmentId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.appointments.freeSlots(appointmentId ?? ''),
    enabled: !!appointmentId,
    queryFn: async (): Promise<FreeSlot[]> => {
      const res = await fetch(`/api/appointments/${appointmentId}/free-slots`)
      if (!res.ok) throw new Error('Não foi possível carregar os horários livres.')
      return (await res.json()).data
    },
  })
}

interface ReschedulePickerProps {
  appointment: AppointmentWithDetails | null
  onClose: () => void
  /** Opens the full form, for a date or time the chips do not offer. */
  onOtherTime: (appointment: AppointmentWithDetails) => void
}

/** The next free slots of the same practitioner and duration, one tap to move there. */
export function ReschedulePicker({ appointment, onClose, onOtherTime }: ReschedulePickerProps) {
  const { move, canNotify } = useMoveAppointment()
  const slots = useFreeSlots(appointment?.id)
  const [notify, setNotify] = React.useState(true)

  const byDay = React.useMemo(() => {
    const groups = new Map<string, FreeSlot[]>()
    for (const slot of slots.data ?? []) groups.set(slot.date, [...(groups.get(slot.date) ?? []), slot])
    return [...groups.entries()]
  }, [slots.data])

  // Free slots are never in the past, so today stands in for whichever one is picked.
  const showNotify = !!appointment && canNotify(appointment, brToday())

  return (
    <Dialog open={appointment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="reschedule-picker">
        <DialogHeader>
          <DialogTitle>Reagendar</DialogTitle>
          {appointment && (
            <DialogDescription>
              {appointmentDisplayName(appointment)} · {appointment.practitionerName}
            </DialogDescription>
          )}
        </DialogHeader>

        {slots.isLoading && <p className="text-sm text-mid">Buscando horários livres...</p>}
        {slots.isError && <p className="text-sm text-red-700">{slots.error.message}</p>}
        {slots.data?.length === 0 && <p className="text-sm text-mid">Nenhum horário livre encontrado nos próximos dias.</p>}

        <div className="grid gap-3">
          {byDay.map(([date, daySlots]) => (
            <div key={date} className="grid gap-1.5">
              <p className="text-xs font-medium text-mid first-letter:uppercase">
                {format(parseLocalDate(date, '12:00:00'), "EEEE, d 'de' MMMM", { locale: ptBR })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {daySlots.map((slot) => (
                  <button
                    key={slot.start}
                    type="button"
                    className="inline-flex min-h-9 items-center rounded-full border border-sage/25 bg-white px-3 text-[13px] font-medium text-charcoal tabular-nums transition-colors hover:border-sage hover:bg-confirmed-bg max-sm:min-h-11"
                    onClick={() => {
                      if (!appointment) return
                      move(appointment, { date, startTime: slot.start, endTime: slot.end }, { notifyPatient: showNotify && notify })
                      onClose()
                    }}
                    data-testid="reschedule-slot"
                  >
                    {slot.start}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {showNotify && (
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)} className="mt-0.5" data-testid="reschedule-notify" />
            <span className="text-sm text-charcoal">Avisar o paciente da nova data por WhatsApp</span>
          </label>
        )}

        <Button
          type="button"
          variant="outline"
          className="max-sm:h-11"
          onClick={() => {
            if (!appointment) return
            onClose()
            onOtherTime(appointment)
          }}
        >
          Outra data ou horário
        </Button>
      </DialogContent>
    </Dialog>
  )
}
