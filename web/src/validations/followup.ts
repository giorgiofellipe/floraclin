import { z } from 'zod'

export const FOLLOWUP_CHANNELS = ['whatsapp', 'call', 'in_person', 'other'] as const
export const FOLLOWUP_OUTCOMES = [
  'agendou',
  'pediu_para_aguardar',
  'sem_resposta',
  'desistiu',
  'outro',
] as const

export type FollowupChannel = (typeof FOLLOWUP_CHANNELS)[number]
export type FollowupOutcome = (typeof FOLLOWUP_OUTCOMES)[number]

export const recordFollowupSchema = z.object({
  channel: z.enum(FOLLOWUP_CHANNELS),
  outcome: z.enum(FOLLOWUP_OUTCOMES),
  notes: z.string().max(2000).optional(),
})

export type RecordFollowupInput = z.infer<typeof recordFollowupSchema>

export const snoozeSchema = z.object({
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD')
    .nullable(),
})

export type SnoozeInput = z.infer<typeof snoozeSchema>
