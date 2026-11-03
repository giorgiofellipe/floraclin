import type { ProcedureStatus } from '@/types'

export type DiagramGroupStatus = 'diagram' | 'quote' | 'in_service' | 'applied' | 'cancelled' | 'declined'

export const DIAGRAM_STATUS_LABELS: Record<DiagramGroupStatus, string> = {
  diagram: 'Diagrama',
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
  hasQuotationLines: boolean
}): DiagramGroupStatus {
  if (input.declinedAt) return 'declined'
  if (input.isSessionGroup) return 'applied'
  if (!input.procedureStatus) return input.hasQuotationLines ? 'quote' : 'diagram'
  if (input.procedureStatus === 'cancelled') return 'cancelled'
  if (input.procedureStatus === 'completed') return 'applied'
  return 'in_service'
}

/** Not linked to any atendimento yet, so it can still be edited or attached. */
export function isOpenDiagram(status: DiagramGroupStatus): boolean {
  return status === 'diagram' || status === 'quote'
}
