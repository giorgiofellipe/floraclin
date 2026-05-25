import { describe, it, expect } from 'vitest'
import {
  sendMessageSchema,
  sendTemplateSchema,
  whatsappSettingsSchema,
  conversationFilterSchema,
} from '../whatsapp'

describe('sendMessageSchema', () => {
  it('passes with valid body', () => {
    const result = sendMessageSchema.safeParse({ body: 'Olá, tudo bem?' })
    expect(result.success).toBe(true)
  })

  it('fails when body is empty', () => {
    const result = sendMessageSchema.safeParse({ body: '' })
    expect(result.success).toBe(false)
  })

  it('fails when body exceeds 4096 characters', () => {
    const result = sendMessageSchema.safeParse({ body: 'a'.repeat(4097) })
    expect(result.success).toBe(false)
  })

  it('passes when body is exactly 4096 characters', () => {
    const result = sendMessageSchema.safeParse({ body: 'a'.repeat(4096) })
    expect(result.success).toBe(true)
  })
})

describe('sendTemplateSchema', () => {
  it('passes with just templateName', () => {
    const result = sendTemplateSchema.safeParse({ templateName: 'welcome' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.language).toBe('pt_BR')
    }
  })

  it('passes with explicit language', () => {
    const result = sendTemplateSchema.safeParse({
      templateName: 'hello',
      language: 'en_US',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.language).toBe('en_US')
    }
  })

  it('passes with params', () => {
    const result = sendTemplateSchema.safeParse({
      templateName: 'appointment_reminder',
      params: { name: 'Maria', date: '2026-05-25' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.params).toEqual({ name: 'Maria', date: '2026-05-25' })
    }
  })

  it('fails when templateName is empty', () => {
    const result = sendTemplateSchema.safeParse({ templateName: '' })
    expect(result.success).toBe(false)
  })

  it('defaults language to pt_BR when omitted', () => {
    const result = sendTemplateSchema.safeParse({ templateName: 'test' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.language).toBe('pt_BR')
    }
  })
})

describe('whatsappSettingsSchema', () => {
  const validSettings = {
    whatsapp_enabled: true,
    whatsapp_phone_number_id: '123456789',
    whatsapp_business_account_id: '987654321',
    whatsapp_access_token: 'EAABsbCS1iZAIBAO...',
    whatsapp_allowed_roles: ['owner', 'practitioner'] as const,
  }

  it('passes with valid full config', () => {
    const result = whatsappSettingsSchema.safeParse(validSettings)
    expect(result.success).toBe(true)
  })

  it('fails when whatsapp_enabled is missing', () => {
    const { whatsapp_enabled, ...rest } = validSettings
    const result = whatsappSettingsSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('allows empty whatsapp_phone_number_id for partial saves', () => {
    const result = whatsappSettingsSchema.safeParse({
      ...validSettings,
      whatsapp_phone_number_id: '',
    })
    expect(result.success).toBe(true)
  })

  it('allows empty whatsapp_business_account_id for partial saves', () => {
    const result = whatsappSettingsSchema.safeParse({
      ...validSettings,
      whatsapp_business_account_id: '',
    })
    expect(result.success).toBe(true)
  })

  it('allows empty whatsapp_access_token for partial saves', () => {
    const result = whatsappSettingsSchema.safeParse({
      ...validSettings,
      whatsapp_access_token: '',
    })
    expect(result.success).toBe(true)
  })

  it('fails with invalid role enum value', () => {
    const result = whatsappSettingsSchema.safeParse({
      ...validSettings,
      whatsapp_allowed_roles: ['admin'],
    })
    expect(result.success).toBe(false)
  })

  it('accepts all valid role values', () => {
    const result = whatsappSettingsSchema.safeParse({
      ...validSettings,
      whatsapp_allowed_roles: ['owner', 'practitioner', 'receptionist', 'financial'],
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty allowed_roles array', () => {
    const result = whatsappSettingsSchema.safeParse({
      ...validSettings,
      whatsapp_allowed_roles: [],
    })
    expect(result.success).toBe(true)
  })
})

describe('conversationFilterSchema', () => {
  it('applies defaults when parsing empty object', () => {
    const result = conversationFilterSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.filter).toBe('all')
      expect(result.data.page).toBe(1)
      expect(result.data.limit).toBe(20)
    }
  })

  it('passes with explicit valid filter', () => {
    const result = conversationFilterSchema.safeParse({ filter: 'unread' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.filter).toBe('unread')
    }
  })

  it('accepts all valid filter values', () => {
    for (const filter of ['all', 'unread', 'prospects', 'patients']) {
      const result = conversationFilterSchema.safeParse({ filter })
      expect(result.success).toBe(true)
    }
  })

  it('fails with invalid filter value', () => {
    const result = conversationFilterSchema.safeParse({ filter: 'archived' })
    expect(result.success).toBe(false)
  })

  it('coerces string page to number', () => {
    const result = conversationFilterSchema.safeParse({ page: '3' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(3)
    }
  })

  it('fails when page is less than 1', () => {
    const result = conversationFilterSchema.safeParse({ page: 0 })
    expect(result.success).toBe(false)
  })

  it('fails when limit exceeds 50', () => {
    const result = conversationFilterSchema.safeParse({ limit: 51 })
    expect(result.success).toBe(false)
  })

  it('allows optional search', () => {
    const result = conversationFilterSchema.safeParse({ search: 'Maria' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.search).toBe('Maria')
    }
  })
})
