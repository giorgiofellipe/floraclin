import type { FormResponses, FormSection } from '@/lib/forms/types'

export interface AnamnesisTemplate {
  version: number
  sections: FormSection[]
}

export interface AnamnesisRecord {
  id: string
  patientId: string
  templateVersion: number
  templateSnapshot: FormSection[]
  responses: FormResponses
  updatedBy: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export interface AnamnesisWrite {
  templateVersion: number
  templateSnapshot: FormSection[]
  responses: FormResponses
}
