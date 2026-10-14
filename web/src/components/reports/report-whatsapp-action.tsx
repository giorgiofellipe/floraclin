import { ExternalLink } from 'lucide-react'
import { toWaMeUrl } from '@/lib/phone'
import { InfoPopover } from '@/components/ui/info-popover'

interface ReportWhatsAppActionProps {
  phone: string
  fullName: string
}

export function ReportWhatsAppAction({ phone, fullName }: ReportWhatsAppActionProps) {
  const waHref = toWaMeUrl(phone)
  if (!waHref) {
    return (
      <InfoPopover content="Paciente sem telefone cadastrado">
        <span className="text-xs text-mid">-</span>
      </InfoPopover>
    )
  }

  return (
    <a
      href={waHref}
      target="_blank"
      rel="noopener noreferrer"
      title={`Abrir conversa no WhatsApp Web com ${fullName}`}
      className="inline-flex h-7 w-7 items-center justify-center rounded-[12px] border border-border bg-background text-[#25D366] transition-colors hover:bg-muted"
    >
      <ExternalLink className="size-3.5" />
    </a>
  )
}
