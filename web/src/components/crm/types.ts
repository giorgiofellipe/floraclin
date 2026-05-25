export type ProspectStage =
  | 'novo'
  | 'contatado'
  | 'qualificado'
  | 'agendado'
  | 'convertido'
  | 'perdido'

export type ProspectIntent = 'inquiry' | 'scheduling' | 'complaint' | 'followup' | 'other'

export type ProspectSentiment = 'positive' | 'neutral' | 'negative'

export interface Prospect {
  id: string
  tenantId: string
  name: string | null
  phone: string
  source: string | null
  stage: ProspectStage
  intent: ProspectIntent | null
  interestedProcedure: string | null
  sentiment: ProspectSentiment | null
  notes: string | null
  assignedUserId: string | null
  assignedUserName: string | null
  whatsappConversationId: string | null
  patientId: string | null
  lostReason: string | null
  createdAt: string
  updatedAt: string
}

export interface ProspectStats {
  novo: number
  contatado: number
  qualificado: number
  agendado: number
  convertido: number
  perdido: number
}

export interface ProspectsResponse {
  data: Prospect[]
  stats: ProspectStats
}

export interface TeamMember {
  id: string
  fullName: string
}
