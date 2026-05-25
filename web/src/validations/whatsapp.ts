import { z } from 'zod'

export const sendMessageSchema = z.object({
  body: z.string().min(1, 'Mensagem é obrigatória').max(4096),
})

export const sendTemplateSchema = z.object({
  templateName: z.string().min(1),
  language: z.string().default('pt_BR'),
  params: z.record(z.string(), z.string()).optional(),
})

export const sendMediaSchema = z.object({
  mediaType: z.enum(['image', 'document', 'audio', 'video']),
  mediaUrl: z.string().url(),
  caption: z.string().max(1024).optional(),
})

export const whatsappSettingsSchema = z.object({
  whatsapp_enabled: z.boolean(),
  whatsapp_phone_number_id: z.string().optional().or(z.literal('')).or(z.null()),
  whatsapp_business_account_id: z.string().optional().or(z.literal('')).or(z.null()),
  whatsapp_access_token: z.string().optional().or(z.literal('')),
  whatsapp_allowed_roles: z.array(z.enum(['owner', 'practitioner', 'receptionist', 'financial'])),
})

export const conversationFilterSchema = z.object({
  search: z.string().optional(),
  filter: z.enum(['all', 'unread', 'prospects', 'patients']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(0).max(50).default(20),
})

export type SendMessageInput = z.infer<typeof sendMessageSchema>
export type SendTemplateInput = z.infer<typeof sendTemplateSchema>
export type SendMediaInput = z.infer<typeof sendMediaSchema>
export type WhatsAppSettings = z.infer<typeof whatsappSettingsSchema>
export type ConversationFilterInput = z.infer<typeof conversationFilterSchema>
