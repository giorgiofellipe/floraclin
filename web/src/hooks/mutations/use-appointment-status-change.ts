'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useUpdateAppointmentStatus } from '@/hooks/mutations/use-appointment-mutations'
import { APPOINTMENT_STATUS_LABELS } from '@/lib/appointment-status'

interface StatusTarget {
  id: string
  status: string
  patientName: string | null
  bookingName: string | null
}

/** One-tap status change with an undo toast, tracking which rows are saving. */
export function useAppointmentStatusChange() {
  const updateStatus = useUpdateAppointmentStatus()
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  function setPending(id: string, pending: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev)
      if (pending) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Per-call mutate() callbacks only fire for the latest call, so two quick taps would lose the first
  // row's toast and leave it disabled. The promise settles for every call.
  function changeStatus(appt: StatusTarget, status: string, then?: () => void) {
    const previous = appt.status
    const name = appt.patientName ?? appt.bookingName ?? 'Agendamento'
    setPending(appt.id, true)
    updateStatus
      .mutateAsync({ id: appt.id, status })
      .then((result) => {
        toast.success(`${name}: ${APPOINTMENT_STATUS_LABELS[status] ?? status}`, {
          action: {
            label: 'Desfazer',
            // The server refuses the undo if anyone changed the appointment after this change.
            onClick: () =>
              updateStatus
                .mutateAsync({ id: appt.id, status: previous, expectedUpdatedAt: result?.data?.updatedAt })
                .catch((err: Error) => toast.error(err.message)),
          },
        })
        then?.()
      })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setPending(appt.id, false))
  }

  return { changeStatus, pendingIds }
}
