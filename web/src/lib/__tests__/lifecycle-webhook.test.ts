import { beforeEach, describe, expect, it, vi } from 'vitest'

const q = vi.hoisted(() => ({
  findLifecycleSendByMetaId: vi.fn(),
  findRecentLifecycleTenantsByPhone: vi.fn(),
  hasRecentConversationForPhone: vi.fn(),
  insertLifecycleReply: vi.fn(),
  updateLifecycleDeliveryStatusByMetaId: vi.fn(),
}))
vi.mock('@/db/queries/lifecycle', () => q)

const notifyDiscord = vi.hoisted(() => vi.fn())
vi.mock('@/lib/discord', () => ({ notifyDiscord }))

const reportSideEffectFailure = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportSideEffectFailure }))

const optOutTenantLifecycle = vi.hoisted(() => vi.fn())
vi.mock('@/lib/lifecycle-opt-out', () => ({ optOutTenantLifecycle }))

import { captureLifecycleReply, handleLifecycleStatus } from '../lifecycle-webhook'

const send = {
  tenantId: 'tenant-1',
  tenantName: 'Clinica Flor',
  messageKey: 'trial_welcome',
  recipient: '5511987654321',
}

function text(body: string, extra: Record<string, unknown> = {}) {
  return { id: 'wamid.in', from: '5511987654321', type: 'text', text: { body }, ...extra }
}

beforeEach(() => {
  vi.resetAllMocks()
  q.findLifecycleSendByMetaId.mockResolvedValue(null)
  q.findRecentLifecycleTenantsByPhone.mockResolvedValue([])
  q.hasRecentConversationForPhone.mockResolvedValue(false)
  q.insertLifecycleReply.mockResolvedValue(true)
  q.updateLifecycleDeliveryStatusByMetaId.mockResolvedValue(false)
})

describe('captureLifecycleReply', () => {
  it('stores and posts a reply whose context is a lifecycle send to the same phone', async () => {
    q.findLifecycleSendByMetaId.mockResolvedValue(send)

    const result = await captureLifecycleReply(text('Oi, tudo bem', { context: { id: 'wamid.out' } }))

    expect(result).toBe(true)
    expect(q.insertLifecycleReply).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      messageKey: 'trial_welcome',
      body: 'Oi, tudo bem',
      metaMessageId: 'wamid.in',
    })
    expect(notifyDiscord).toHaveBeenCalledWith({
      kind: 'lifecycle.reply',
      tenantName: 'Clinica Flor',
      tenantId: 'tenant-1',
      messageKey: 'trial_welcome',
      body: 'Oi, tudo bem',
    })
  })

  it('rejects a reply quoting a lifecycle send from another phone (forwarded or spoofed reply attributed to the wrong clinic)', async () => {
    q.findLifecycleSendByMetaId.mockResolvedValue({ ...send, recipient: '5521911112222' })

    const result = await captureLifecycleReply(text('oi', { context: { id: 'wamid.out' } }))

    expect(result).toBe(false)
    expect(q.insertLifecycleReply).not.toHaveBeenCalled()
    expect(q.findRecentLifecycleTenantsByPhone).not.toHaveBeenCalled()
    expect(reportSideEffectFailure).toHaveBeenCalledWith(expect.any(Error), {
      area: 'lifecycle',
      step: 'reply_mismatch',
      extra: { tenantId: 'tenant-1' },
    })
  })

  it('captures a contextless message from a phone with one recent lifecycle clinic and no conversation', async () => {
    q.findRecentLifecycleTenantsByPhone.mockResolvedValue([
      { tenantId: 'tenant-1', tenantName: 'Clinica Flor', messageKey: 'trial_first_patient' },
    ])

    const result = await captureLifecycleReply(text('quero ajuda'))

    expect(result).toBe(true)
    expect(q.insertLifecycleReply).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', messageKey: 'trial_first_patient' }),
    )
  })

  it('leaves the message to normal routing when the phone has a recent clinic conversation (owner who is also a patient)', async () => {
    q.findRecentLifecycleTenantsByPhone.mockResolvedValue([
      { tenantId: 'tenant-1', tenantName: 'Clinica Flor', messageKey: 'trial_welcome' },
    ])
    q.hasRecentConversationForPhone.mockResolvedValue(true)

    const result = await captureLifecycleReply(text('confirmo'))

    expect(result).toBe(false)
    expect(q.insertLifecycleReply).not.toHaveBeenCalled()
  })

  it('opts out on a contextless PARAR even when the phone has a recent clinic conversation', async () => {
    q.findRecentLifecycleTenantsByPhone.mockResolvedValue([
      { tenantId: 'tenant-1', tenantName: 'Clinica Flor', messageKey: 'trial_welcome' },
    ])
    q.hasRecentConversationForPhone.mockResolvedValue(true)

    const result = await captureLifecycleReply(text('PARAR'))

    expect(result).toBe(true)
    expect(optOutTenantLifecycle).toHaveBeenCalledWith('tenant-1')
  })

  it('does not capture and reports when two clinics sent to the same phone', async () => {
    q.findRecentLifecycleTenantsByPhone.mockResolvedValue([
      { tenantId: 'tenant-1', tenantName: 'A', messageKey: 'trial_welcome' },
      { tenantId: 'tenant-2', tenantName: 'B', messageKey: 'trial_welcome' },
    ])

    const result = await captureLifecycleReply(text('oi'))

    expect(result).toBe(false)
    expect(q.insertLifecycleReply).not.toHaveBeenCalled()
    expect(reportSideEffectFailure).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ area: 'lifecycle', step: 'reply_ambiguous' }),
    )
  })

  it('does not capture a contextless message from a phone with no lifecycle send', async () => {
    expect(await captureLifecycleReply(text('oi'))).toBe(false)
    expect(q.insertLifecycleReply).not.toHaveBeenCalled()
  })

  it('opts the clinic out on "Parar " but not on a normal reply', async () => {
    q.findLifecycleSendByMetaId.mockResolvedValue(send)

    await captureLifecycleReply(text('Parar ', { context: { id: 'wamid.out' } }))
    expect(optOutTenantLifecycle).toHaveBeenCalledWith('tenant-1')

    optOutTenantLifecycle.mockClear()
    await captureLifecycleReply(text('Não quero parar de testar', { context: { id: 'wamid.out' } }))
    expect(optOutTenantLifecycle).not.toHaveBeenCalled()
  })

  it('treats an accented keyword as an opt-out once the accent is stripped', async () => {
    q.findLifecycleSendByMetaId.mockResolvedValue(send)

    await captureLifecycleReply(text('Saír', { context: { id: 'wamid.out' } }))

    expect(optOutTenantLifecycle).toHaveBeenCalledWith('tenant-1')
  })

  it('applies the opt-out on a Meta retry of a stored reply, without a second Discord post', async () => {
    q.findLifecycleSendByMetaId.mockResolvedValue(send)
    q.insertLifecycleReply.mockResolvedValue(false)

    const result = await captureLifecycleReply(text('parar', { context: { id: 'wamid.out' } }))

    expect(result).toBe(true)
    expect(optOutTenantLifecycle).toHaveBeenCalledWith('tenant-1')
    expect(notifyDiscord).not.toHaveBeenCalled()
  })

  it('does not store the reply when the opt-out fails, so the retry can still apply it (reply stored while opt-out lost)', async () => {
    q.findLifecycleSendByMetaId.mockResolvedValue(send)
    optOutTenantLifecycle.mockRejectedValue(new Error('db down'))

    await expect(
      captureLifecycleReply(text('parar', { context: { id: 'wamid.out' } })),
    ).rejects.toThrow('db down')

    expect(q.insertLifecycleReply).not.toHaveBeenCalled()
  })

  it('stores a placeholder for media messages', async () => {
    q.findLifecycleSendByMetaId.mockResolvedValue(send)

    await captureLifecycleReply({
      id: 'wamid.img',
      from: '5511987654321',
      type: 'image',
      context: { id: 'wamid.out' },
    })

    expect(q.insertLifecycleReply).toHaveBeenCalledWith(
      expect.objectContaining({ body: '[mídia]' }),
    )
  })

  it('stores the button text of a button reply', async () => {
    q.findLifecycleSendByMetaId.mockResolvedValue(send)

    await captureLifecycleReply({
      id: 'wamid.btn',
      from: '5511987654321',
      type: 'button',
      button: { text: 'Quero ajuda' },
      context: { id: 'wamid.out' },
    })

    expect(q.insertLifecycleReply).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Quero ajuda' }),
    )
  })
})

describe('handleLifecycleStatus', () => {
  it('updates delivered/read lifecycle delivery status by Meta message id', async () => {
    q.updateLifecycleDeliveryStatusByMetaId.mockResolvedValue(true)

    const result = await handleLifecycleStatus({
      id: 'wamid.out',
      status: 'read',
      timestamp: '1760628600',
    })

    expect(result).toBe(true)
    expect(q.updateLifecycleDeliveryStatusByMetaId).toHaveBeenCalledWith('wamid.out', {
      status: 'read',
      timestamp: new Date(1760628600 * 1000),
      errorCode: null,
      error: null,
    })
  })

  it('stores failed lifecycle status error details', async () => {
    q.updateLifecycleDeliveryStatusByMetaId.mockResolvedValue(true)

    const result = await handleLifecycleStatus({
      id: 'wamid.out',
      status: 'failed',
      errors: [{ code: '131026', title: 'Undeliverable', message: 'Recipient not on WhatsApp' }],
    })

    expect(result).toBe(true)
    expect(q.updateLifecycleDeliveryStatusByMetaId).toHaveBeenCalledWith('wamid.out', {
      status: 'failed',
      timestamp: undefined,
      errorCode: '131026',
      error: 'Recipient not on WhatsApp',
    })
  })

  it('returns false for a delivered status on a non-lifecycle id so patient status handling runs', async () => {
    const result = await handleLifecycleStatus({ id: 'wamid.patient', status: 'delivered' })

    expect(result).toBe(false)
    expect(q.updateLifecycleDeliveryStatusByMetaId).toHaveBeenCalledWith('wamid.patient', {
      status: 'delivered',
      timestamp: undefined,
      errorCode: null,
      error: null,
    })
  })

  it('returns true for a delivered status on a lifecycle id', async () => {
    q.updateLifecycleDeliveryStatusByMetaId.mockResolvedValue(true)

    expect(await handleLifecycleStatus({ id: 'wamid.out', status: 'delivered' })).toBe(true)
  })

  it('falls back to a match check for unsupported statuses', async () => {
    q.findLifecycleSendByMetaId.mockResolvedValue(send)

    expect(await handleLifecycleStatus({ id: 'wamid.out', status: 'deleted' })).toBe(true)
    expect(q.updateLifecycleDeliveryStatusByMetaId).not.toHaveBeenCalled()
  })
})
