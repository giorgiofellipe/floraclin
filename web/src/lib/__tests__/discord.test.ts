import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// next/server's after() throws when called outside a request scope, which is
// exactly the situation in a unit test. Stub it to run the callback
// immediately so the fetch behavior it schedules is actually observable.
vi.mock('next/server', () => ({
  after: (task: () => unknown) => task(),
}))

const captureExceptionMock = vi.fn()
const captureMessageMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}))

import { buildDiscordPayload, notifyDiscord, type DiscordEvent } from '../discord'

describe('buildDiscordPayload', () => {
  it('formats clinic.created with title and clinic/location fields', () => {
    const payload = buildDiscordPayload({
      kind: 'clinic.created',
      tenantName: 'Clínica Bela Pele',
      city: 'São Paulo',
      state: 'SP',
      tenantId: 'tenant-1',
    })

    const embed = payload.embeds[0]
    expect(embed.title).toBe('Nova clínica cadastrada')
    expect(embed.fields).toContainEqual({ name: 'Clínica', value: 'Clínica Bela Pele', inline: true })
    expect(embed.fields).toContainEqual({ name: 'Localização', value: 'São Paulo/SP', inline: true })
  })

  it('formats clinic.created location gracefully when city/state are missing', () => {
    const payload = buildDiscordPayload({
      kind: 'clinic.created',
      tenantName: 'Clínica Sem Endereço',
      city: null,
      state: null,
      tenantId: 'tenant-2',
    })

    const embed = payload.embeds[0]
    expect(embed.fields).toContainEqual({ name: 'Localização', value: 'Não informado', inline: true })
  })

  it('formats clinic.approved with title and clinic field', () => {
    const payload = buildDiscordPayload({
      kind: 'clinic.approved',
      tenantName: 'Clínica Bela Pele',
      tenantId: 'tenant-1',
    })

    const embed = payload.embeds[0]
    expect(embed.title).toBe('Clínica aprovada')
    expect(embed.fields).toContainEqual({ name: 'Clínica', value: 'Clínica Bela Pele', inline: true })
  })

  it('formats subscription.created with plan and formatted price', () => {
    const payload = buildDiscordPayload({
      kind: 'subscription.created',
      tenantName: 'Clínica Bela Pele',
      planName: 'Profissional',
      priceCents: 19900,
      tenantId: 'tenant-1',
    })

    const embed = payload.embeds[0]
    expect(embed.title).toBe('Nova assinatura')
    expect(embed.fields).toContainEqual({ name: 'Plano', value: 'Profissional', inline: true })
    const priceField = embed.fields.find((f) => f.name === 'Valor')
    expect(priceField?.value).toMatch(/R\$\s*199,00/)
  })

  it('includes an admin link built from NEXT_PUBLIC_APP_URL for every event kind', () => {
    const original = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.floraclin.com.br'

    try {
      const payload = buildDiscordPayload({
        kind: 'clinic.approved',
        tenantName: 'Clínica Bela Pele',
        tenantId: 'tenant-1',
      })
      const embed = payload.embeds[0]
      expect(embed.fields).toContainEqual({ name: 'Admin', value: 'https://app.floraclin.com.br/admin/clinicas' })
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = original
    }
  })

  it('never includes personal data (owner name, email or phone) in any event payload', () => {
    const events: DiscordEvent[] = [
      { kind: 'clinic.created', tenantName: 'Clínica Bela Pele', city: 'São Paulo', state: 'SP', tenantId: 'tenant-1' },
      { kind: 'clinic.approved', tenantName: 'Clínica Bela Pele', tenantId: 'tenant-1' },
      { kind: 'subscription.created', tenantName: 'Clínica Bela Pele', planName: 'Profissional', priceCents: 19900, tenantId: 'tenant-1' },
    ]

    const forbidden = ['owner', 'email', 'phone', 'telefone', '@', 'cpf']

    for (const event of events) {
      const payload = buildDiscordPayload(event)
      const serialized = JSON.stringify(payload).toLowerCase()
      for (const term of forbidden) {
        expect(serialized).not.toContain(term)
      }
    }
  })
})

describe('notifyDiscord', () => {
  const originalFetch = global.fetch
  const originalWebhook = process.env.DISCORD_WEBHOOK_EVENTS

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env.DISCORD_WEBHOOK_EVENTS = originalWebhook
  })

  it('calls fetch zero times when DISCORD_WEBHOOK_EVENTS is unset (the guard that protects the real channel)', async () => {
    delete process.env.DISCORD_WEBHOOK_EVENTS
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await notifyDiscord({ kind: 'clinic.approved', tenantName: 'Clínica Bela Pele', tenantId: 'tenant-1' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts to the configured webhook when DISCORD_WEBHOOK_EVENTS is set', async () => {
    process.env.DISCORD_WEBHOOK_EVENTS = 'https://discord.com/api/webhooks/test'
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    global.fetch = fetchMock as unknown as typeof fetch

    await notifyDiscord({ kind: 'clinic.approved', tenantName: 'Clínica Bela Pele', tenantId: 'tenant-1' })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/test',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('does not throw when fetch rejects', async () => {
    process.env.DISCORD_WEBHOOK_EVENTS = 'https://discord.com/api/webhooks/test'
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    await expect(
      notifyDiscord({ kind: 'clinic.approved', tenantName: 'Clínica Bela Pele', tenantId: 'tenant-1' }),
    ).resolves.toBeUndefined()

    expect(captureExceptionMock).toHaveBeenCalledOnce()
  })

  it('does not throw and reports to Sentry when the webhook responds with a non-ok status', async () => {
    process.env.DISCORD_WEBHOOK_EVENTS = 'https://discord.com/api/webhooks/test'
    global.fetch = vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch

    await expect(
      notifyDiscord({ kind: 'clinic.approved', tenantName: 'Clínica Bela Pele', tenantId: 'tenant-1' }),
    ).resolves.toBeUndefined()

    expect(captureMessageMock).toHaveBeenCalledOnce()
  })
})
