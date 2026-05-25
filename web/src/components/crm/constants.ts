import type { ProspectStage, ProspectIntent } from './types'

export const PROSPECT_STAGES: ProspectStage[] = [
  'novo',
  'contatado',
  'qualificado',
  'agendado',
  'convertido',
  'perdido',
]

export const STAGE_CONFIG: Record<
  ProspectStage,
  { label: string; color: string; bg: string }
> = {
  novo: { label: 'Novo', color: '#25D366', bg: '#E8F8EE' },
  contatado: { label: 'Contatado', color: '#42A5F5', bg: '#E3F2FD' },
  qualificado: { label: 'Qualificado', color: '#FFA726', bg: '#FFF3E0' },
  agendado: { label: 'Agendado', color: '#AB47BC', bg: '#F3E5F5' },
  convertido: { label: 'Convertido', color: '#66BB6A', bg: '#E8F5E9' },
  perdido: { label: 'Perdido', color: '#EF5350', bg: '#FFEBEE' },
}

export const INTENT_CONFIG: Record<
  ProspectIntent,
  { label: string; color: string; bg: string }
> = {
  inquiry: { label: 'Consulta', color: '#1565C0', bg: '#E3F2FD' },
  scheduling: { label: 'Agendamento', color: '#2E7D32', bg: '#E8F5E9' },
  complaint: { label: 'Reclamação', color: '#C62828', bg: '#FFEBEE' },
  followup: { label: 'Retorno', color: '#F57F17', bg: '#FFF8E1' },
  other: { label: 'Outro', color: '#757575', bg: '#F5F5F5' },
}

export const SENTIMENT_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  positive: { label: 'Positivo', color: '#66BB6A' },
  neutral: { label: 'Neutro', color: '#FFA726' },
  negative: { label: 'Negativo', color: '#EF5350' },
}
