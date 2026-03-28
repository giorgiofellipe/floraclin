export type Role = 'owner' | 'practitioner' | 'receptionist' | 'financial'

export type AppointmentStatus = 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'

export type AppointmentSource = 'internal' | 'online_booking'

export type ProcedureStatus = 'in_progress' | 'completed' | 'cancelled'

export type TimelineStage = 'pre' | 'immediate_post' | '7d' | '30d' | '90d' | 'other'

export type ConsentType = 'general' | 'botox' | 'filler' | 'biostimulator' | 'custom'

export type AcceptanceMethod = 'checkbox' | 'signature' | 'both'

export type PaymentMethod = 'pix' | 'credit_card' | 'debit_card' | 'cash' | 'transfer'

export type FinancialStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled'

export type InstallmentStatus = 'pending' | 'paid' | 'overdue'

export type DiagramViewType = 'front' | 'left_profile' | 'right_profile'

export type QuantityUnit = 'U' | 'mL'

export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'logout' | 'consent_accepted' | 'impersonation_start' | 'impersonation_end'

export interface AuthContext {
  userId: string
  tenantId: string
  role: Role
  email: string
  fullName: string
}

export interface PaginationParams {
  page: number
  limit: number
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}
