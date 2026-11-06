'use client'

import { useState } from 'react'
import { ChevronDownIcon, FileTextIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useResendNfseEmail } from '@/hooks/queries/use-nfse-documents'
import type { NfseDocumentSummary } from '@/lib/nfse/types'
import { CancelNfseDialog } from './cancel-nfse-dialog'
import { nfseStatusChip } from './status-labels'

interface NfsePaymentChipProps {
  payment: { id: string; nfse?: NfseDocumentSummary | null }
  canEmit: boolean
  canCancel: boolean
  onEmit: (paymentRecordId: string) => void
}

export function NfsePaymentChip({ payment, canEmit, canCancel: roleCanCancel, onEmit }: NfsePaymentChipProps) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const resend = useResendNfseEmail()
  const nfse = payment.nfse ?? null
  const active = nfse && nfse.status !== 'cancelled' ? nfse : null
  const canRetry = nfse?.status === 'failed' && nfse.retryable
  const hasDocument = nfse?.status === 'issued' || nfse?.status === 'cancelled'
  const canResend = nfse?.status === 'issued'
  const canCancel = roleCanCancel && nfse?.status === 'issued'
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

  const chip = nfse ? nfseStatusChip(nfse) : null
  const hasMenu = hasDocument || canCancel || canRetry

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
            {hasDocument && nfse && (
              <>
                <DropdownMenuItem onClick={() => window.open(`/api/nfse/${nfse.id}/pdf`, '_blank', 'noopener,noreferrer')}>
                  Ver PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`/api/nfse/${nfse.id}/xml`, '_blank', 'noopener,noreferrer')}>
                  Baixar XML
                </DropdownMenuItem>
                {canResend && (
                  <DropdownMenuItem onClick={() => handleResend(nfse.id)}>Reenviar email</DropdownMenuItem>
                )}
              </>
            )}
            {canCancel && (
              <DropdownMenuItem onClick={() => setCancelOpen(true)}>
                {nfse?.cancelRequested ? 'Tentar cancelar de novo' : 'Cancelar NFS-e'}
              </DropdownMenuItem>
            )}
            {canRetry && <DropdownMenuItem onClick={() => onEmit(payment.id)}>Tentar de novo</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {canEmitNew && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px] text-forest hover:bg-sage/10"
          data-testid="nfse-emit"
          onClick={() => onEmit(payment.id)}
        >
          <FileTextIcon className="h-3 w-3" />
          Emitir NFS-e
        </Button>
      )}
      {nfse && <CancelNfseDialog documentId={nfse.id} open={cancelOpen} onOpenChange={setCancelOpen} />}
    </>
  )
}
