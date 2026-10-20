'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { subDays } from 'date-fns'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InfoPopover } from '@/components/ui/info-popover'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTenant } from '@/hooks/queries/use-tenant'
import { isWhatsAppEnabled } from '@/lib/whatsapp-mode'
import { REACTIVATION_COOLDOWN_DAYS } from '@/lib/whatsapp-automation-config'
import { MARKETING_CREDIT_COST } from '@/lib/whatsapp-credits'
import { tryNormalizeBrPhoneForWhatsApp } from '@/lib/phone'
import { formatDate } from '@/lib/utils'

interface ReportReactivationActionProps {
  patientId: string
  fullName: string
  phone: string
  marketingOptOut: boolean
  /** ISO instant, as the report JSON carries it. */
  reactivationSentAt: string | Date | null
}

export function ReportReactivationAction({
  patientId,
  fullName,
  phone,
  marketingOptOut,
  reactivationSentAt,
}: ReportReactivationActionProps) {
  const queryClient = useQueryClient()
  const { data: tenant } = useTenant()
  const [now] = useState(() => new Date())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const send = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/reactivation`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao enviar mensagem')
      }
    },
    onSuccess: () => {
      setConfirmOpen(false)
      toast.success(`Mensagem de reativação enviada para ${fullName}`)
      queryClient.invalidateQueries({ queryKey: ['reports', 'pacientes-inativos'] })
    },
    onError: (err) => toast.error(err.message),
  })

  if (!isWhatsAppEnabled(tenant?.settings)) return null

  function blockedReason(): string | null {
    if (marketingOptOut) return 'Paciente optou por não receber mensagens promocionais'
    if (!tryNormalizeBrPhoneForWhatsApp(phone).ok) return 'Telefone inválido para WhatsApp'
    const sentAt = reactivationSentAt ? new Date(reactivationSentAt) : null
    if (sentAt && sentAt > subDays(now, REACTIVATION_COOLDOWN_DAYS)) {
      return `Mensagem de reativação já enviada em ${formatDate(sentAt)}`
    }
    return null
  }

  const blocked = blockedReason()
  const triggerClassName = 'bg-[#25D366] text-white hover:bg-[#1DA851] disabled:opacity-50'

  if (blocked) {
    return (
      <InfoPopover content={blocked}>
        <Button type="button" size="icon-sm" data-testid="send-reactivation" disabled className={triggerClassName}>
          <Send className="size-3.5" />
        </Button>
      </InfoPopover>
    )
  }

  return (
    <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            data-testid="send-reactivation"
            title="Enviar mensagem de reativação"
            className={triggerClassName}
          />
        }
      >
        <Send className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 text-xs">
        <p className="text-charcoal">
          Enviar mensagem de reativação para {fullName}? Usa {MARKETING_CREDIT_COST} créditos.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="confirm-reactivation"
            disabled={send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Enviar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
