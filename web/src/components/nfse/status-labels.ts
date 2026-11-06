import type { NfseDocumentStatus } from '@/lib/nfse/types'

export const NFSE_STATUS_LABELS: Record<NfseDocumentStatus, string> = {
  pending: 'Na fila',
  processing: 'Processando',
  issued: 'Emitida',
  failed: 'Falhou',
  cancelled: 'Cancelada',
}

export function nfseStatusChip(nfse: { status: NfseDocumentStatus; cancelRequested: boolean }): {
  label: string
  className: string
} {
  if (nfse.status === 'cancelled') return { label: NFSE_STATUS_LABELS.cancelled, className: 'bg-neutral-100 text-mid' }
  if (nfse.status === 'failed') return { label: NFSE_STATUS_LABELS.failed, className: 'bg-red-50 text-red-700' }
  if (nfse.status === 'pending' || nfse.status === 'processing') {
    return { label: NFSE_STATUS_LABELS.processing, className: 'bg-sky-50 text-sky-700' }
  }
  if (nfse.cancelRequested) return { label: 'Cancelamento pendente', className: 'bg-amber-50 text-amber-700' }
  return { label: NFSE_STATUS_LABELS.issued, className: 'bg-emerald-50 text-emerald-700' }
}
