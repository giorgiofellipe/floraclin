import { ExternalLink } from 'lucide-react'
import { toWhatsAppPhone } from '@/lib/phone'

interface ReportWhatsAppActionProps {
  phone: string
  fullName: string
}

/**
 * Opens a WhatsApp Web conversation for the patient, mirroring the
 * "Abrir no WhatsApp Web" action already used on the Aniversariantes screen
 * (`@/components/patients/birthday-row-actions.tsx`): the same `wa.me` link
 * pattern, built from the shared `toWhatsAppPhone` helper rather than a new
 * one-off digit-cleaning function. Shared by every recall report's
 * `rowAction` (pacientes inativos, retornos, faltas) so the send affordance
 * stays identical across all three.
 */
export function ReportWhatsAppAction({ phone, fullName }: ReportWhatsAppActionProps) {
  if (!phone.trim()) {
    return (
      <span className="text-xs text-mid" title="Paciente sem telefone cadastrado">
        -
      </span>
    )
  }

  return (
    <a
      href={`https://wa.me/${toWhatsAppPhone(phone)}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Abrir conversa no WhatsApp Web com ${fullName}`}
      className="inline-flex h-7 w-7 items-center justify-center rounded-[12px] border border-border bg-background text-[#25D366] transition-colors hover:bg-muted"
    >
      <ExternalLink className="size-3.5" />
    </a>
  )
}
