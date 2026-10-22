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
  it('formats signup.started with the person, e-mail and method, and no clinic name', () => {
    const payload = buildDiscordPayload({
      kind: 'signup.started',
      ownerName: 'Giorgio Teste',
      ownerEmail: 'giorgio@example.com',
      method: 'google',
      tenantId: 'tenant-1',
    })

    const embed = payload.embeds[0]
    expect(embed.title).toBe('Novo cadastro (onboarding pendente)')
    expect(embed.fields.map((field) => field.name)).toEqual(['Nome', 'E-mail', 'Método', 'Admin'])
    expect(embed.fields).toContainEqual({ name: 'Nome', value: '`Giorgio Teste`', inline: true })
    expect(embed.fields).toContainEqual({ name: 'E-mail', value: '`giorgio@example.com`', inline: true })
    expect(embed.fields).toContainEqual({ name: 'Método', value: 'Google', inline: true })
  })

  it('labels an e-mail/password signup.started as E-mail', () => {
    const payload = buildDiscordPayload({
      kind: 'signup.started',
      ownerName: 'Ana',
      ownerEmail: 'ana@example.com',
      method: 'email',
      tenantId: 'tenant-1',
    })
    expect(payload.embeds[0].fields).toContainEqual({ name: 'Método', value: 'E-mail', inline: true })
  })

  it('shows signup.started UTM source and campaign as inline code, so a crafted value cannot render a link', () => {
    const payload = buildDiscordPayload({
      kind: 'signup.started',
      ownerName: '[x](https://evil.example)',
      ownerEmail: 'a@b.c',
      method: 'email',
      tenantId: 'tenant-1',
      attribution: { utmSource: 'meta`ads', utmCampaign: '[promo](https://evil.example)' },
    })

    const embed = payload.embeds[0]
    expect(embed.fields).toContainEqual({ name: 'Nome', value: '`[x](https://evil.example)`', inline: true })
    expect(embed.fields).toContainEqual({ name: 'UTM Source', value: '`metaads`', inline: true })
    expect(embed.fields).toContainEqual({ name: 'UTM Campaign', value: '`[promo](https://evil.example)`', inline: true })
  })

  it('omits UTM fields for an organic signup.started', () => {
    const payload = buildDiscordPayload({
      kind: 'signup.started',
      ownerName: 'Ana',
      ownerEmail: 'ana@example.com',
      method: 'email',
      tenantId: 'tenant-1',
      attribution: {},
    })
    expect(payload.embeds[0].fields.map((field) => field.name)).toEqual(['Nome', 'E-mail', 'Método', 'Admin'])
  })

  it('formats onboarding.completed with the real clinic data and time since sign-up', () => {
    const payload = buildDiscordPayload({
      kind: 'onboarding.completed',
      tenantName: 'Clínica Bela Pele',
      phone: '(11) 98765-4321',
      city: 'São Paulo',
      state: 'SP',
      elapsed: 'em 4 min',
      tenantId: 'tenant-1',
    })

    const embed = payload.embeds[0]
    expect(embed.title).toBe('Cadastro concluído')
    expect(embed.description).toBe('Onboarding concluído em 4 min após o cadastro.')
    expect(embed.fields).toContainEqual({ name: 'Clínica', value: '`Clínica Bela Pele`', inline: true })
    expect(embed.fields).toContainEqual({ name: 'Telefone', value: '`(11) 98765-4321`', inline: true })
    expect(embed.fields).toContainEqual({ name: 'Localização', value: '`São Paulo/SP`', inline: true })
  })

  // Discord rejects the whole post when one field is over 1024 characters,
  // and the onboarding clinic name has no length limit.
  it('caps a very long clinic name so the post stays under Discord\'s field limit', () => {
    const payload = buildDiscordPayload({
      kind: 'onboarding.completed',
      tenantName: 'A'.repeat(5000),
      phone: null,
      city: null,
      state: null,
      elapsed: 'em 4 min',
      tenantId: 't-1',
    })
    const clinic = payload.embeds[0].fields.find((f) => f.name === 'Clínica')!.value
    expect(clinic.length).toBeLessThanOrEqual(1024)
    expect(clinic).toBe(`\`${'A'.repeat(1000)}...\``)
  })

  it('formats onboarding.completed gracefully when phone and location are missing', () => {
    const payload = buildDiscordPayload({
      kind: 'onboarding.completed',
      tenantName: 'Clínica Sem Endereço',
      phone: null,
      city: null,
      state: null,
      elapsed: 'em 2 dias',
      tenantId: 'tenant-2',
    })

    const embed = payload.embeds[0]
    expect(embed.fields).toContainEqual({ name: 'Telefone', value: '`Não informado`', inline: true })
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
      if (original === undefined) {
        delete process.env.NEXT_PUBLIC_APP_URL
      } else {
        process.env.NEXT_PUBLIC_APP_URL = original
      }
    }
  })

  it('never includes personal data (owner name, email or phone) in the events that do not carry it', () => {
    const events: DiscordEvent[] = [
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

describe('buildDiscordPayload lifecycle.reply', () => {
  it('truncates a 5000-char reply to 1000 chars plus an ellipsis so Discord does not reject the 4096-char description limit', () => {
    const payload = buildDiscordPayload({
      kind: 'lifecycle.reply',
      tenantName: 'Clínica Bela Pele',
      tenantId: 'tenant-1',
      messageKey: 'trial_feedback',
      body: 'a'.repeat(5000),
    })

    expect(payload.embeds[0].description).toBe('a'.repeat(1000) + '...')
  })
})

describe('buildDiscordPayload whatsapp_automations.digest', () => {
  it('formats a routine run as a compact one-line totals description, with no tenant list', () => {
    const payload = buildDiscordPayload({
      kind: 'whatsapp_automations.digest',
      tenantsProcessed: 10,
      sent: 4,
      anamnesisSent: 2,
      summary: { sent: 3, no_pending_appointments: 7 },
      failingTenants: [],
    })

    const embed = payload.embeds[0]
    expect(embed.title).toBe('WhatsApp automations: execução diária')
    expect(embed.description).toBe('10 clínicas processadas, 4 confirmações e 2 links de anamnese enviados.')
    expect(embed.description).not.toContain('\n')
  })

  it('formats an abnormal run listing every failing tenant by name and reason', () => {
    const payload = buildDiscordPayload({
      kind: 'whatsapp_automations.digest',
      tenantsProcessed: 10,
      sent: 2,
      anamnesisSent: 0,
      summary: { sent: 2, send_failed: 1, credit_exhausted: 1 },
      failingTenants: [
        { tenantName: 'Clínica Bela Pele', reason: 'send_failed', appointmentsFailed: 3, anamnesisFailed: 1 },
        { tenantName: 'Clínica Sem Créditos', reason: 'credit_exhausted', appointmentsFailed: 0, anamnesisFailed: 0 },
      ],
    })

    const embed = payload.embeds[0]
    expect(embed.title).toBe('WhatsApp automations: falhas na execução')
    expect(embed.description).toContain('10 clínicas processadas, 2 confirmações e 0 links de anamnese enviados.')
    expect(embed.description).toContain('Clínica Bela Pele: falha ao enviar (3 confirmações, 1 links de anamnese)')
    expect(embed.description).toContain('Clínica Sem Créditos: créditos esgotados')
  })

  it('never includes patient names or phone numbers in the digest', () => {
    const payload = buildDiscordPayload({
      kind: 'whatsapp_automations.digest',
      tenantsProcessed: 1,
      sent: 0,
      anamnesisSent: 0,
      summary: { send_failed: 1 },
      failingTenants: [
        { tenantName: 'Clínica Bela Pele', reason: 'send_failed', appointmentsFailed: 1, anamnesisFailed: 0 },
      ],
    })

    const serialized = JSON.stringify(payload).toLowerCase()
    for (const term of ['telefone', 'phone', '@', 'cpf']) {
      expect(serialized).not.toContain(term)
    }
  })
})

describe('notifyDiscord', () => {
  const originalFetch = global.fetch
  const originalWebhook = process.env.DISCORD_WEBHOOK_EVENTS
  const originalWebhookLogs = process.env.DISCORD_WEBHOOK_LOGS

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (originalWebhook === undefined) {
      delete process.env.DISCORD_WEBHOOK_EVENTS
    } else {
      process.env.DISCORD_WEBHOOK_EVENTS = originalWebhook
    }
    if (originalWebhookLogs === undefined) {
      delete process.env.DISCORD_WEBHOOK_LOGS
    } else {
      process.env.DISCORD_WEBHOOK_LOGS = originalWebhookLogs
    }
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

  describe('whatsapp_automations.digest destination (DISCORD_WEBHOOK_LOGS)', () => {
    const digestEvent: DiscordEvent = {
      kind: 'whatsapp_automations.digest',
      tenantsProcessed: 10,
      sent: 4,
      anamnesisSent: 0,
      summary: { sent: 4 },
      failingTenants: [],
    }

    it('calls fetch zero times when DISCORD_WEBHOOK_LOGS is unset, even if DISCORD_WEBHOOK_EVENTS is set (the guard that protects the real channel)', async () => {
      delete process.env.DISCORD_WEBHOOK_LOGS
      process.env.DISCORD_WEBHOOK_EVENTS = 'https://discord.com/api/webhooks/events'
      const fetchMock = vi.fn()
      global.fetch = fetchMock as unknown as typeof fetch

      await notifyDiscord(digestEvent)

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('posts once to DISCORD_WEBHOOK_LOGS, not DISCORD_WEBHOOK_EVENTS, when configured', async () => {
      process.env.DISCORD_WEBHOOK_LOGS = 'https://discord.com/api/webhooks/logs'
      process.env.DISCORD_WEBHOOK_EVENTS = 'https://discord.com/api/webhooks/events'
      const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
      global.fetch = fetchMock as unknown as typeof fetch

      await notifyDiscord(digestEvent)

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(fetchMock).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/logs',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('does not throw and reports to Sentry when the webhook is unreachable, so a down Discord cannot fail the caller', async () => {
      process.env.DISCORD_WEBHOOK_LOGS = 'https://discord.com/api/webhooks/logs'
      global.fetch = vi.fn(async () => {
        throw new Error('network down')
      }) as unknown as typeof fetch

      await expect(notifyDiscord(digestEvent)).resolves.toBeUndefined()

      expect(captureExceptionMock).toHaveBeenCalledOnce()
    })

    it('does not post a business event (clinic.approved) to DISCORD_WEBHOOK_LOGS', async () => {
      delete process.env.DISCORD_WEBHOOK_EVENTS
      process.env.DISCORD_WEBHOOK_LOGS = 'https://discord.com/api/webhooks/logs'
      const fetchMock = vi.fn()
      global.fetch = fetchMock as unknown as typeof fetch

      await notifyDiscord({ kind: 'clinic.approved', tenantName: 'Clínica Bela Pele', tenantId: 'tenant-1' })

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
