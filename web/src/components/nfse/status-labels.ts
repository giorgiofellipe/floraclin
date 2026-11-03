import type { NfseDocumentStatus } from '@/lib/nfse/types'

export const NFSE_STATUS_LABELS: Record<NfseDocumentStatus, string> = {
  pending: 'Na fila',
  processing: 'Processando',
  issued: 'Emitida',
  failed: 'Falhou',
  cancelled: 'Cancelada',
}
