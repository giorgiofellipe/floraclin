'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Clock, CalendarClock, MessageCircle, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface PendingAppointment {
  id: string
  tenantId: string
  patientId: string | null
  practitionerId: string
  date: string
  startTime: string
  endTime: string
  status: string
  bookingName: string | null
  bookingPhone: string | null
  notes: string | null
  updatedAt: string
  patientName: string | null
  patientPhone: string | null
  practitionerName: string
}

function formatDateBr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export function PendingRescheduleList() {
  const [appointments, setAppointments] = useState<PendingAppointment[]>([])
  const [loading, setLoading] = useState(true)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [openingChatId, setOpeningChatId] = useState<string | null>(null)
  const router = useRouter()

  const fetchAppointments = useCallback(async () => {
    try {
      const res = await fetch('/api/appointments/pending-reschedule')
      if (!res.ok) throw new Error('Erro ao buscar reagendamentos')
      const json = await res.json()
      setAppointments(json.data ?? [])
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao buscar reagendamentos',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAppointments()
  }, [fetchAppointments])

  async function handleCancel(appointmentId: string) {
    setCancellingId(appointmentId)
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Erro ao cancelar agendamento')
      }
      toast.success('Agendamento cancelado.')
      setAppointments((prev) => prev.filter((a) => a.id !== appointmentId))
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao cancelar agendamento',
      )
    } finally {
      setCancellingId(null)
    }
  }

  async function handleOpenChat(appt: PendingAppointment) {
    if (!appt.patientId) return
    setOpeningChatId(appt.id)
    try {
      const res = await fetch('/api/whatsapp/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: appt.patientId }),
      })
      if (!res.ok) throw new Error('Erro ao abrir conversa')
      const data = await res.json()
      const name = appt.patientName || appt.bookingName || 'Paciente'
      const firstName = name.split(' ')[0]
      const draft = encodeURIComponent(
        `Olá, ${firstName}! Vi que você solicitou reagendamento da sua consulta do dia ${formatDateBr(appt.date)} às ${appt.startTime.slice(0, 5)}. Qual horário fica melhor para você?`
      )
      router.push(`/whatsapp?conversa=${data.data.conversation.id}&draft=${draft}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao abrir conversa')
    } finally {
      setOpeningChatId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-gray-100 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-8 w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (appointments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Clock className="size-10 text-[#B0B0B0] mb-3" />
        <p className="text-[13px] text-[#7A7A7A]">
          Nenhuma consulta aguardando reagendamento.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {appointments.map((appt) => {
        const displayName = appt.patientName || appt.bookingName || 'Paciente'
        const timePending = formatDistanceToNow(new Date(appt.updatedAt), {
          locale: ptBR,
          addSuffix: true,
        })
        const displayNameEncoded = encodeURIComponent(displayName)
        const rescheduleHref = appt.patientId
          ? `/agenda?open=new&patient=${appt.patientId}&patientName=${displayNameEncoded}`
          : '/agenda?open=new'

        return (
          <div
            key={appt.id}
            className="rounded-lg border-l-4 border-l-amber-400 border border-amber-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-[#2A2A2A] truncate">
                  {displayName}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#7A7A7A]">
                  <span>
                    {formatDateBr(appt.date)} &middot; {appt.startTime.slice(0, 5)}&ndash;{appt.endTime.slice(0, 5)}
                  </span>
                  <span>{appt.practitionerName}</span>
                </div>
                <p className="flex items-center gap-1 text-[11px] text-amber-600">
                  <CalendarClock className="size-3" />
                  Pendente {timePending}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {appt.patientId && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={openingChatId === appt.id}
                    onClick={() => handleOpenChat(appt)}
                  >
                    <MessageCircle className="size-3.5 mr-1" />
                    WhatsApp
                  </Button>
                )}
                <Link href={rescheduleHref}>
                  <Button variant="default" size="sm">
                    Reagendar
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[#7A7A7A] hover:text-red-600"
                  disabled={cancellingId === appt.id}
                  onClick={() => handleCancel(appt.id)}
                >
                  <X className="size-3.5 mr-1" />
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
