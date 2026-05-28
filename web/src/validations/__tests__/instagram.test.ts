import { describe, it, expect } from 'vitest'
import {
  instagramSettingsSchema,
  sendInstagramMessageSchema,
  sendInstagramTextSchema,
  sendInstagramMediaSchema,
  startInstagramConversationSchema,
  conversationActionSchema,
  savedReplyInputSchema,
  linkPatientSchema,
} from '../instagram'

describe('sendInstagramMessageSchema', () => {
  it('accepts a valid text variant', () => {
    const result = sendInstagramMessageSchema.safeParse({
      type: 'text',
      body: 'Olá!',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid media variant without caption', () => {
    const result = sendInstagramMessageSchema.safeParse({
      type: 'media',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.com/foo.jpg',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid media variant with caption', () => {
    const result = sendInstagramMessageSchema.safeParse({
      type: 'media',
      mediaType: 'video',
      mediaUrl: 'https://cdn.example.com/foo.mp4',
      caption: 'Veja só',
    })
    expect(result.success).toBe(true)
  })

  it('accepts all valid mediaType values', () => {
    for (const mediaType of ['image', 'video', 'audio', 'file']) {
      const result = sendInstagramMessageSchema.safeParse({
        type: 'media',
        mediaType,
        mediaUrl: 'https://cdn.example.com/asset',
      })
      expect(result.success).toBe(true)
    }
  })

  it('rejects an unknown mediaType', () => {
    const result = sendInstagramMessageSchema.safeParse({
      type: 'media',
      mediaType: 'sticker',
      mediaUrl: 'https://cdn.example.com/foo.png',
    })
    expect(result.success).toBe(false)
  })

  it('rejects media with a non-URL mediaUrl', () => {
    const result = sendInstagramMessageSchema.safeParse({
      type: 'media',
      mediaType: 'image',
      mediaUrl: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })

  it('rejects text variant with empty body', () => {
    const result = sendInstagramMessageSchema.safeParse({ type: 'text', body: '' })
    expect(result.success).toBe(false)
  })

  it('rejects text body exceeding 1000 chars', () => {
    const result = sendInstagramMessageSchema.safeParse({
      type: 'text',
      body: 'a'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })

  it('accepts text body of exactly 1000 chars', () => {
    const result = sendInstagramTextSchema.safeParse({
      type: 'text',
      body: 'a'.repeat(1000),
    })
    expect(result.success).toBe(true)
  })

  it('rejects media caption longer than 1000 chars', () => {
    const result = sendInstagramMediaSchema.safeParse({
      type: 'media',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.com/foo.jpg',
      caption: 'a'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown discriminator', () => {
    const result = sendInstagramMessageSchema.safeParse({
      type: 'sticker',
      body: 'hello',
    })
    expect(result.success).toBe(false)
  })
})

describe('savedReplyInputSchema', () => {
  it('accepts a valid minimal payload', () => {
    const result = savedReplyInputSchema.safeParse({
      name: 'Saudação',
      body: 'Olá, tudo bem?',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a purposeKey of null', () => {
    const result = savedReplyInputSchema.safeParse({
      name: 'Saudação',
      body: 'Olá',
      purposeKey: null,
    })
    expect(result.success).toBe(true)
  })

  it('accepts a purposeKey string', () => {
    const result = savedReplyInputSchema.safeParse({
      name: 'Saudação',
      body: 'Olá',
      purposeKey: 'greeting',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = savedReplyInputSchema.safeParse({
      name: '',
      body: 'Olá',
    })
    expect(result.success).toBe(false)
  })

  it('rejects name longer than 255 chars', () => {
    const result = savedReplyInputSchema.safeParse({
      name: 'a'.repeat(256),
      body: 'Olá',
    })
    expect(result.success).toBe(false)
  })

  it('accepts name of exactly 255 chars', () => {
    const result = savedReplyInputSchema.safeParse({
      name: 'a'.repeat(255),
      body: 'Olá',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty body', () => {
    const result = savedReplyInputSchema.safeParse({
      name: 'Saudação',
      body: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects body longer than 2000 chars', () => {
    const result = savedReplyInputSchema.safeParse({
      name: 'Saudação',
      body: 'a'.repeat(2001),
    })
    expect(result.success).toBe(false)
  })

  it('accepts body of exactly 2000 chars', () => {
    const result = savedReplyInputSchema.safeParse({
      name: 'Saudação',
      body: 'a'.repeat(2000),
    })
    expect(result.success).toBe(true)
  })

  it('rejects purposeKey longer than 100 chars', () => {
    const result = savedReplyInputSchema.safeParse({
      name: 'Saudação',
      body: 'Olá',
      purposeKey: 'a'.repeat(101),
    })
    expect(result.success).toBe(false)
  })
})

describe('conversationActionSchema', () => {
  it('accepts mark_read without patientId', () => {
    const result = conversationActionSchema.safeParse({ action: 'mark_read' })
    expect(result.success).toBe(true)
  })

  it('accepts unlink_patient without patientId', () => {
    const result = conversationActionSchema.safeParse({ action: 'unlink_patient' })
    expect(result.success).toBe(true)
  })

  it('accepts link_patient with a valid uuid patientId', () => {
    const result = conversationActionSchema.safeParse({
      action: 'link_patient',
      patientId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
  })

  it('rejects link_patient without patientId', () => {
    const result = conversationActionSchema.safeParse({ action: 'link_patient' })
    expect(result.success).toBe(false)
  })

  it('rejects link_patient with non-uuid patientId', () => {
    const result = conversationActionSchema.safeParse({
      action: 'link_patient',
      patientId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown action', () => {
    const result = conversationActionSchema.safeParse({ action: 'archive' })
    expect(result.success).toBe(false)
  })
})

describe('instagramSettingsSchema', () => {
  it('accepts a fully-populated settings object', () => {
    const result = instagramSettingsSchema.safeParse({
      instagram_enabled: true,
      instagram_allowed_roles: ['owner', 'practitioner'],
      instagram_page_id: '1234567890',
      instagram_business_account_id: '0987654321',
      instagram_page_access_token: 'EAAGm...token',
    })
    expect(result.success).toBe(true)
  })

  it('accepts the minimal { instagram_enabled: false } form (defaults applied)', () => {
    const result = instagramSettingsSchema.safeParse({ instagram_enabled: false })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.instagram_allowed_roles).toEqual(['owner'])
    }
  })

  it('accepts null values for the optional credentials', () => {
    const result = instagramSettingsSchema.safeParse({
      instagram_enabled: true,
      instagram_allowed_roles: [],
      instagram_page_id: null,
      instagram_business_account_id: null,
      instagram_page_access_token: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects when instagram_enabled is missing', () => {
    const result = instagramSettingsSchema.safeParse({
      instagram_allowed_roles: ['owner'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects when instagram_enabled is not a boolean', () => {
    const result = instagramSettingsSchema.safeParse({ instagram_enabled: 'yes' })
    expect(result.success).toBe(false)
  })

  it('rejects empty page_id string (min(1))', () => {
    const result = instagramSettingsSchema.safeParse({
      instagram_enabled: true,
      instagram_page_id: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('startInstagramConversationSchema', () => {
  it('accepts minimal payload', () => {
    const result = startInstagramConversationSchema.safeParse({
      igsid: '1234567890',
      body: 'Oi',
    })
    expect(result.success).toBe(true)
  })

  it('accepts payload with savedReplyId', () => {
    const result = startInstagramConversationSchema.safeParse({
      igsid: '1234567890',
      savedReplyId: '550e8400-e29b-41d4-a716-446655440000',
      body: 'Oi',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty igsid', () => {
    const result = startInstagramConversationSchema.safeParse({ igsid: '', body: 'Oi' })
    expect(result.success).toBe(false)
  })

  it('rejects non-uuid savedReplyId', () => {
    const result = startInstagramConversationSchema.safeParse({
      igsid: '1234567890',
      savedReplyId: 'nope',
      body: 'Oi',
    })
    expect(result.success).toBe(false)
  })

  it('rejects body longer than 1000 chars', () => {
    const result = startInstagramConversationSchema.safeParse({
      igsid: '1234567890',
      body: 'a'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })
})

describe('linkPatientSchema', () => {
  it('accepts a valid uuid', () => {
    const result = linkPatientSchema.safeParse({
      patientId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-uuid', () => {
    const result = linkPatientSchema.safeParse({ patientId: 'nope' })
    expect(result.success).toBe(false)
  })
})
