export interface TimelineEntry {
  id: string
  type:
    | 'patient_created'
    | 'anamnesis_updated'
    | 'plan_created'
    | 'plan_approved'
    | 'plan_executed'
    | 'plan_cancelled'
    | 'consent_signed'
    | 'contract_signed'
    | 'financial_created'
    | 'payment_received'
    | 'photo_uploaded'
    | 'appointment'
  date: string
  title: string
  description?: string
  meta?: string
  procedureId?: string
}

export interface TimelineGroup {
  id: string
  type: 'service'
  procedureId: string
  title: string
  status: string
  entries: TimelineEntry[]
}

export interface PatientTimeline {
  groups: TimelineGroup[]
  ungrouped: TimelineEntry[]
}
