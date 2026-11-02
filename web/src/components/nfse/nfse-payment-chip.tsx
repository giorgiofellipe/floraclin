'use client'

import { useState } from 'react'
import { ChevronDownIcon, FileTextIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useResendNfseEmail } from '@/hooks/queries/use-nfse-documents'
import type { NfseDocumentSummary } from '@/lib/nfse/types'
import { CancelNfseDialog } from './cancel-nfse-dialog'

interface NfsePaymentChipProps {
  payment: { id: string; nfse?: NfseDocumentSummary | null }
  canEmit: boolean
  canCancel: boolean
  onEmit: (paymentRecordId: string) => void
}

function chipOf(nfse: NfseDocumentSummary): { label: string; className: string } {
  if (nfse.status === 'cancelled') return { label: 'Cancelada', className: 'bg-neutral-100 text-mid' }
  if (nfse.status === 'failed') return { label: 'Falhou', className: 'bg-red-50 text-red-700' }
  if (nfse.status === 'pending' || nfse.status === 'processing') {
    return { label: 'Processando', className: 'bg-sky-50 text-sky-700' }
  }
  if (nfse.cancelRequested) return { label: 'Cancelamento pendente', className: 'bg-amber-50 text-amber-700' }
  return { label: 'Emitida', className: 'bg-emerald-50 text-emerald-700' }
}

export function NfsePaymentChip({ payment, canEmit, canCancel: roleCanCancel, onEmit }: NfsePaymentChipProps) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const resend = useResendNfseEmail()
  const nfse = payment.nfse ?? null
  const active = nfse && nfse.status !== 'cancelled' ? nfse : null
  const canRetry = nfse?.status === 'failed' && nfse.retryable
  const canDownload = nfse?.status === 'issued'
  const canCancel = roleCanCancel && nfse?.status === 'issued' && !nfse.cancelRequested
  const canEmitNew = canEmit && !active

  async function handleResend(id: string) {
    try {
      await resend.mutateAsync(id)
      toast.success('Email enviado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao reenviar o email')
    }
  }

  if (!nfse && !canEmitNew) return null

  const chip = nfse ? chipOf(nfse) : null
  const hasMenu = canDownload || canCancel || canRetry || canEmitNew

  return (
    <>
      {chip && (
        <span
          title={nfse?.errorMessage ?? undefined}
          className={cn('inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium', chip.className)}
        >
          NFS-e {chip.label}
        </span>
      )}
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Ações da NFS-e"
                data-testid="nfse-menu"
                className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-mid hover:text-charcoal"
              >
                <FileTextIcon className="h-3 w-3" />
                <ChevronDownIcon className="h-3 w-3" />
              </button>
            }
          />
          <DropdownMenuContent align="end">
            {canDownload && nfse && (
              <>
                <DropdownMenuItem onClick={() => window.open(`/api/nfse/${nfse.id}/pdf`, '_blank', 'noopener,noreferrer')}>
                  Ver PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`/api/nfse/${nfse.id}/xml`, '_blank', 'noopener,noreferrer')}>
                  Baixar XML
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleResend(nfse.id)}>Reenviar email</DropdownMenuItem>
              </>
            )}
            {canCancel && <DropdownMenuItem onClick={() => setCancelOpen(true)}>Cancelar NFS-e</DropdownMenuItem>}
            {canRetry && <DropdownMenuItem onClick={() => onEmit(payment.id)}>Tentar de novo</DropdownMenuItem>}
            {canEmitNew && <DropdownMenuItem onClick={() => onEmit(payment.id)}>Emitir NFS-e</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {nfse && <CancelNfseDialog documentId={nfse.id} open={cancelOpen} onOpenChange={setCancelOpen} />}
    </>
  )
}
