import type { ProcedureStatus } from '@/types'

export type DiagramGroupStatus = 'quote' | 'in_service' | 'applied' | 'cancelled' | 'declined'

export const DIAGRAM_STATUS_LABELS: Record<DiagramGroupStatus, string> = {
  quote: 'Orçamento',
  in_service: 'Em atendimento',
  applied: 'Aplicado',
  cancelled: 'Cancelado',
  declined: 'Recusado',
}

export function deriveDiagramStatus(input: {
  isSessionGroup: boolean
  procedureStatus: ProcedureStatus | null
  declinedAt: Date | string | null
}): DiagramGroupStatus {
  if (input.declinedAt) return 'declined'
  if (input.isSessionGroup) return 'applied'
  if (!input.procedureStatus) return 'quote'
  if (input.procedureStatus === 'cancelled') return 'cancelled'
  if (input.procedureStatus === 'completed') return 'applied'
  return 'in_service'
}
