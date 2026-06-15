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
  whatsapp_mode: z.enum(['floraclin', 'own']).optional(),
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

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(255).regex(/^[a-z][a-z0-9_]*$/, 'Nome deve ser snake_case (letras minúsculas, números e _)'),
  category: z.enum(['UTILITY', 'MARKETING']),
  language: z.string().default('pt_BR'),
  components: z.array(z.record(z.string(), z.unknown())).min(1, 'Template deve ter ao menos um componente'),
  purposeKey: z.string().max(100).optional(),
  variableMapping: z.array(z.object({
    index: z.number().int().positive(),
    key: z.string(),
    label: z.string(),
    example: z.string(),
  })).optional(),
})

export const updateTemplateSchema = z.object({
  components: z.array(z.record(z.string(), z.unknown())).min(1),
  variableMapping: z.array(z.object({
    index: z.number().int().positive(),
    key: z.string(),
    label: z.string(),
    example: z.string(),
  })).optional(),
})

export const updateAutomationSchema = z.object({
  enabled: z.boolean().optional(),
  templateId: z.string().uuid().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
})

export type SendMessageInput = z.infer<typeof sendMessageSchema>
export type SendTemplateInput = z.infer<typeof sendTemplateSchema>
export type SendMediaInput = z.infer<typeof sendMediaSchema>
export type WhatsAppSettings = z.infer<typeof whatsappSettingsSchema>
export type ConversationFilterInput = z.infer<typeof conversationFilterSchema>
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>
