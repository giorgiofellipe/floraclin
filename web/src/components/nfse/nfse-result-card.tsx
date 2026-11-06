'use client'

import { CheckCircle2Icon, ClockIcon, Loader2Icon, XCircleIcon, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import type { NfseDocumentStatus, NfseEmissionResult } from '@/lib/nfse/types'

interface StatusView {
  icon: LucideIcon
  iconClassName: string
  title: (result: NfseEmissionResult) => string
}

const ISSUED: StatusView = {
  icon: CheckCircle2Icon,
  iconClassName: 'text-emerald-600',
  title: (result) => (result.nfseNumber ? `NFS-e nº ${result.nfseNumber}` : 'NFS-e emitida'),
}

const IN_PROGRESS: StatusView = {
  icon: ClockIcon,
  iconClassName: 'text-sky-700',
  title: () => 'Em processamento',
}

const STATUS_VIEWS: Record<NfseDocumentStatus, StatusView> = {
  issued: ISSUED,
  failed: { icon: XCircleIcon, iconClassName: 'text-red-600', title: () => 'NFS-e não emitida' },
  pending: IN_PROGRESS,
  processing: IN_PROGRESS,
  cancelled: { icon: XCircleIcon, iconClassName: 'text-mid', title: () => 'NFS-e cancelada' },
}

function emailLine(result: NfseEmissionResult): string | null {
  if (result.emailSent) return `Enviada por email para ${result.email}`
  if (!result.email) return 'Paciente sem email: a nota não foi enviada.'
  if (result.emailRequested) return 'O email não foi enviado. Reenvie pelo menu da NFS-e.'
  return null
}

function openDocument(id: string, format: 'pdf' | 'xml') {
  window.open(`/api/nfse/${id}/${format}`, '_blank', 'noopener,noreferrer')
}

interface NfseResultCardProps {
  result: NfseEmissionResult
  retrying: boolean
  onRetry: (result: NfseEmissionResult) => void
}

export function NfseResultCard({ result, retrying, onRetry }: NfseResultCardProps) {
  const view = STATUS_VIEWS[result.status]
  const Icon = view.icon
  const email = result.status === 'issued' ? emailLine(result) : null

  return (
    <li className="flex gap-3 rounded-md border border-[#E8ECEF] px-3 py-3" data-testid="nfse-result">
      <Icon className={`mt-0.5 size-5 shrink-0 ${view.iconClassName}`} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="font-medium text-charcoal">{view.title(result)}</p>
        <p className="text-mid">
          {result.patientName} · {formatCurrency(result.value)}
        </p>
        {result.status === 'failed' && result.errorMessage && <p className="text-red-700">{result.errorMessage}</p>}
        {view === IN_PROGRESS && (
          <p className="text-mid">A Sefin ainda está processando. O status aparece no pagamento quando concluir.</p>
        )}
        {email && <p className="text-mid">{email}</p>}
        {result.status === 'issued' && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => openDocument(result.id, 'pdf')}>
              Ver PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => openDocument(result.id, 'xml')}>
              Baixar XML
            </Button>
          </div>
        )}
        {result.status === 'failed' && (
          <div className="pt-1">
            <Button size="sm" variant="outline" disabled={retrying} onClick={() => onRetry(result)}>
              {retrying && <Loader2Icon className="size-4 animate-spin" />}
              Tentar de novo
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
