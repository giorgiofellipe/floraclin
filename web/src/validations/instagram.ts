import { z } from 'zod'

export const instagramSettingsSchema = z.object({
  instagram_enabled: z.boolean(),
  instagram_allowed_roles: z
    .array(z.enum(['owner', 'practitioner', 'receptionist', 'financial']))
    .default(['owner']),
  instagram_page_id: z.string().min(1).optional().nullable(),
  instagram_business_account_id: z.string().min(1).optional().nullable(),
  instagram_page_access_token: z.string().min(1).optional().nullable(),
})

export const sendInstagramTextSchema = z.object({
  type: z.literal('text'),
  body: z.string().min(1).max(1000),
})

export const sendInstagramMediaSchema = z.object({
  type: z.literal('media'),
  mediaType: z.enum(['image', 'video', 'audio', 'file']),
  mediaUrl: z.string().url(),
  caption: z.string().max(1000).optional(),
})

export const sendInstagramMessageSchema = z.discriminatedUnion('type', [
  sendInstagramTextSchema,
  sendInstagramMediaSchema,
])

export const startInstagramConversationSchema = z.object({
  igsid: z.string().min(1),
  savedReplyId: z.string().uuid().optional(),
  body: z.string().min(1).max(1000),
})

export const conversationActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mark_read') }),
  z.object({ action: z.literal('link_patient'), patientId: z.string().uuid() }),
  z.object({ action: z.literal('unlink_patient') }),
])

export const savedReplyInputSchema = z.object({
  name: z.string().min(1).max(255),
  body: z.string().min(1).max(2000),
  purposeKey: z.string().max(100).optional().nullable(),
})

export const linkPatientSchema = z.object({
  patientId: z.string().uuid(),
})

export type InstagramSettings = z.infer<typeof instagramSettingsSchema>
export type SendInstagramTextInput = z.infer<typeof sendInstagramTextSchema>
export type SendInstagramMediaInput = z.infer<typeof sendInstagramMediaSchema>
export type SendInstagramMessageInput = z.infer<typeof sendInstagramMessageSchema>
export type StartInstagramConversationInput = z.infer<typeof startInstagramConversationSchema>
export type ConversationActionInput = z.infer<typeof conversationActionSchema>
export type SavedReplyInput = z.infer<typeof savedReplyInputSchema>
export type LinkPatientInput = z.infer<typeof linkPatientSchema>
