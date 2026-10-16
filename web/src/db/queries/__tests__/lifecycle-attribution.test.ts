import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbMock, state } = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    insertedValues: [] as unknown[],
    insertReturning: [{ id: 'event-1' }],
  }

  function selectChain(result: unknown[]) {
    const chain: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'orderBy']) {
      chain[method] = vi.fn(() => chain)
    }
    chain.limit = vi.fn(() => result)
    return chain
  }

  const dbMock = {
    select: vi.fn(() => selectChain(state.selectResults.shift() ?? [])),
    insert: vi.fn(() => {
      const chain = {
        values: vi.fn((value: unknown) => {
          state.insertedValues.push(value)
          return chain
        }),
        onConflictDoNothing: vi.fn(() => chain),
        returning: vi.fn(() => state.insertReturning),
      }
      return chain
    }),
  }

  return { dbMock, state }
})

vi.mock('@/db/client', () => ({ db: dbMock }))
vi.mock('@/db/schema', () => ({
  tenants: {},
  whatsappConversations: {},
  tenantLifecycleReplies: {},
  tenantLifecycleMessages: {
    id: 'id',
    tenantId: 'tenant_id',
    tenantName: 'tenant_name',
    messageKey: 'message_key',
    channel: 'channel',
    metaMessageId: 'meta_message_id',
    recipient: 'recipient',
    status: 'status',
    claimedAt: 'claimed_at',
    completedAt: 'completed_at',
    deliveredAt: 'delivered_at',
  },
  tenantLifecycleEvents: {
    id: 'id',
    tenantId: 'tenant_id',
    lifecycleMessageId: 'lifecycle_message_id',
    messageKey: 'message_key',
    channel: 'channel',
    eventType: 'event_type',
    conversionType: 'conversion_type',
    createdAt: 'created_at',
  },
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((...args: unknown[]) => args),
  gte: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(() => ({})),
}))

import { recordLifecycleActivation, recordLifecycleClick } from '@/db/queries/lifecycle'

describe('lifecycle attribution queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.selectResults = []
    state.insertedValues = []
    state.insertReturning = [{ id: 'event-1' }]
  })

  it('records click events against the lifecycle send id', async () => {
    state.selectResults.push([
      { id: 'send-1', tenantId: 'tenant-1', messageKey: 'trial_welcome', channel: 'email' },
    ])

    await expect(
      recordLifecycleClick({
        sendId: 'send-1',
        destination: 'https://app.floraclin.com.br/dashboard?lc=send-1',
        userAgent: 'vitest',
        ipAddress: '203.0.113.10',
      }),
    ).resolves.toBe(true)

    expect(state.insertedValues[0]).toMatchObject({
      tenantId: 'tenant-1',
      lifecycleMessageId: 'send-1',
      messageKey: 'trial_welcome',
      channel: 'email',
      eventType: 'click',
      metadata: {
        destination: 'https://app.floraclin.com.br/dashboard?lc=send-1',
        userAgent: 'vitest',
        ipAddress: '203.0.113.10',
      },
    })
  })

  it('attributes activation to the last clicked lifecycle message', async () => {
    state.selectResults.push([
      { lifecycleMessageId: 'send-1', messageKey: 'trial_first_patient', channel: 'email' },
    ])

    await expect(recordLifecycleActivation('tenant-1', 'first_patient')).resolves.toBe(true)

    expect(state.insertedValues[0]).toMatchObject({
      tenantId: 'tenant-1',
      lifecycleMessageId: 'send-1',
      messageKey: 'trial_first_patient',
      channel: 'email',
      eventType: 'activation',
      conversionType: 'first_patient',
    })
  })

  it('does not record activation when there is no lifecycle click inside the window', async () => {
    state.selectResults.push([])

    await expect(recordLifecycleActivation('tenant-1', 'first_patient')).resolves.toBe(false)
    expect(state.insertedValues).toHaveLength(0)
  })
})
