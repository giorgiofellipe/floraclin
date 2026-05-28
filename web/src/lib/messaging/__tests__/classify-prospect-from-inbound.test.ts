import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mutable handle for the rows returned by the procedureTypes select.
const procedureRowsRef: { current: Array<{ id: string; name: string; defaultPrice: string | null }> } = {
  current: [],
}

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => procedureRowsRef.current),
      })),
    })),
  },
}))

vi.mock('@/db/schema', () => ({
  procedureTypes: {
    id: 'id',
    name: 'name',
    defaultPrice: 'default_price',
    tenantId: 'tenant_id',
  },
}))

const classifyMessageMock = vi.fn()
vi.mock('@/lib/classify-prospect', () => ({
  classifyMessage: (...args: unknown[]) => classifyMessageMock(...args),
}))

const updateProspectMock = vi.fn()
const setProspectProceduresMock = vi.fn()
const logProspectActivityMock = vi.fn()
vi.mock('@/db/queries/prospects', () => ({
  updateProspect: (...args: unknown[]) => updateProspectMock(...args),
  setProspectProcedures: (...args: unknown[]) => setProspectProceduresMock(...args),
  logProspectActivity: (...args: unknown[]) => logProspectActivityMock(...args),
}))

const pushSseEventMock = vi.fn()
vi.mock('@/db/queries/whatsapp', () => ({
  pushSseEvent: (...args: unknown[]) => pushSseEventMock(...args),
}))

const baseClassification = {
  intent: 'inquiry' as const,
  sentiment: 'neutral' as const,
  interestedProcedures: [] as string[],
  extractedName: null as string | null,
}

describe('classifyProspectFromInbound — short-circuits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    procedureRowsRef.current = []
    classifyMessageMock.mockReset()
    updateProspectMock.mockReset()
    setProspectProceduresMock.mockReset()
    logProspectActivityMock.mockReset()
    pushSseEventMock.mockReset()
    updateProspectMock.mockResolvedValue(undefined)
    setProspectProceduresMock.mockResolvedValue(undefined)
    logProspectActivityMock.mockResolvedValue(undefined)
    pushSseEventMock.mockResolvedValue(undefined)
  })

  it('skips classification entirely when stage is not "novo"', async () => {
    const { classifyProspectFromInbound } = await import('../classify-prospect-from-inbound')
    await classifyProspectFromInbound({
      tenantId: 't-1',
      prospectId: 'p-1',
      prospectStage: 'contatado',
      recentInboundBodies: ['oi'],
    })
    expect(classifyMessageMock).not.toHaveBeenCalled()
    expect(updateProspectMock).not.toHaveBeenCalled()
    expect(pushSseEventMock).not.toHaveBeenCalled()
  })

  it('skips classification when recentInboundBodies is empty', async () => {
    const { classifyProspectFromInbound } = await import('../classify-prospect-from-inbound')
    await classifyProspectFromInbound({
      tenantId: 't-1',
      prospectId: 'p-1',
      prospectStage: 'novo',
      recentInboundBodies: [],
    })
    expect(classifyMessageMock).not.toHaveBeenCalled()
    expect(updateProspectMock).not.toHaveBeenCalled()
    expect(pushSseEventMock).not.toHaveBeenCalled()
  })
})

describe('classifyProspectFromInbound — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    procedureRowsRef.current = []
    classifyMessageMock.mockReset()
    updateProspectMock.mockReset().mockResolvedValue(undefined)
    setProspectProceduresMock.mockReset().mockResolvedValue(undefined)
    logProspectActivityMock.mockReset().mockResolvedValue(undefined)
    pushSseEventMock.mockReset().mockResolvedValue(undefined)
  })

  it('matches a single procedure name, sets value, and calls all side-effects', async () => {
    procedureRowsRef.current = [
      { id: 'proc-1', name: 'Botox', defaultPrice: '1200.00' },
      { id: 'proc-2', name: 'Preenchimento', defaultPrice: '900.00' },
    ]
    classifyMessageMock.mockResolvedValue({
      ...baseClassification,
      intent: 'inquiry',
      interestedProcedures: ['Botox'],
    })

    const { classifyProspectFromInbound } = await import('../classify-prospect-from-inbound')
    await classifyProspectFromInbound({
      tenantId: 't-1',
      prospectId: 'p-1',
      prospectStage: 'novo',
      recentInboundBodies: ['Quanto custa botox?'],
    })

    expect(classifyMessageMock).toHaveBeenCalledTimes(1)
    expect(classifyMessageMock).toHaveBeenCalledWith(
      ['Quanto custa botox?'],
      ['Botox', 'Preenchimento'],
    )

    expect(setProspectProceduresMock).toHaveBeenCalledWith('t-1', 'p-1', ['proc-1'])

    expect(updateProspectMock).toHaveBeenCalledTimes(1)
    expect(updateProspectMock).toHaveBeenCalledWith(
      't-1',
      'p-1',
      expect.objectContaining({
        intent: 'inquiry',
        sentiment: 'neutral',
        value: '1200.00',
      }),
    )

    expect(logProspectActivityMock).toHaveBeenCalledWith(
      't-1',
      'p-1',
      'ai_classified',
      expect.objectContaining({
        intent: 'inquiry',
        sentiment: 'neutral',
        interestedProcedures: ['Botox'],
        autoValue: '1200.00',
      }),
    )
  })

  it('sums defaultPrice across all matched procedures', async () => {
    procedureRowsRef.current = [
      { id: 'proc-1', name: 'Botox', defaultPrice: '1200.00' },
      { id: 'proc-2', name: 'Preenchimento', defaultPrice: '900.50' },
      { id: 'proc-3', name: 'Limpeza de Pele', defaultPrice: '300.00' },
    ]
    classifyMessageMock.mockResolvedValue({
      ...baseClassification,
      interestedProcedures: ['Botox', 'Preenchimento'],
    })

    const { classifyProspectFromInbound } = await import('../classify-prospect-from-inbound')
    await classifyProspectFromInbound({
      tenantId: 't-1',
      prospectId: 'p-1',
      prospectStage: 'novo',
      recentInboundBodies: ['quero botox e preenchimento'],
    })

    expect(setProspectProceduresMock).toHaveBeenCalledWith(
      't-1',
      'p-1',
      ['proc-1', 'proc-2'],
    )
    expect(updateProspectMock).toHaveBeenCalledWith(
      't-1',
      'p-1',
      expect.objectContaining({ value: '2100.50' }),
    )
  })

  it('case-insensitively matches procedure names', async () => {
    procedureRowsRef.current = [
      { id: 'proc-1', name: 'Botox', defaultPrice: '500.00' },
    ]
    classifyMessageMock.mockResolvedValue({
      ...baseClassification,
      interestedProcedures: ['BOTOX'],
    })

    const { classifyProspectFromInbound } = await import('../classify-prospect-from-inbound')
    await classifyProspectFromInbound({
      tenantId: 't-1',
      prospectId: 'p-1',
      prospectStage: 'novo',
      recentInboundBodies: ['BOTOX?'],
    })

    expect(setProspectProceduresMock).toHaveBeenCalledWith('t-1', 'p-1', ['proc-1'])
  })

  it('does not call setProspectProcedures when classification matches no procedures', async () => {
    procedureRowsRef.current = [
      { id: 'proc-1', name: 'Botox', defaultPrice: '500.00' },
    ]
    classifyMessageMock.mockResolvedValue({
      ...baseClassification,
      interestedProcedures: [],
    })

    const { classifyProspectFromInbound } = await import('../classify-prospect-from-inbound')
    await classifyProspectFromInbound({
      tenantId: 't-1',
      prospectId: 'p-1',
      prospectStage: 'novo',
      recentInboundBodies: ['oi'],
    })

    expect(setProspectProceduresMock).not.toHaveBeenCalled()
    // updateProspect still runs (intent/sentiment), but without a value field
    expect(updateProspectMock).toHaveBeenCalledWith(
      't-1',
      'p-1',
      expect.not.objectContaining({ value: expect.anything() }),
    )
  })

  it('includes extractedName in updateProspect when present', async () => {
    procedureRowsRef.current = []
    classifyMessageMock.mockResolvedValue({
      ...baseClassification,
      interestedProcedures: [],
      extractedName: 'Maria Silva',
    })

    const { classifyProspectFromInbound } = await import('../classify-prospect-from-inbound')
    await classifyProspectFromInbound({
      tenantId: 't-1',
      prospectId: 'p-1',
      prospectStage: 'novo',
      recentInboundBodies: ['oi, sou a Maria'],
    })

    expect(updateProspectMock).toHaveBeenCalledWith(
      't-1',
      'p-1',
      expect.objectContaining({ name: 'Maria Silva' }),
    )
  })
})

describe('classifyProspectFromInbound — resilience (fire-and-forget)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    procedureRowsRef.current = []
    classifyMessageMock.mockReset()
    updateProspectMock.mockReset().mockResolvedValue(undefined)
    setProspectProceduresMock.mockReset().mockResolvedValue(undefined)
    logProspectActivityMock.mockReset().mockResolvedValue(undefined)
    pushSseEventMock.mockReset().mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('does not throw when classifyMessage rejects', async () => {
    procedureRowsRef.current = []
    classifyMessageMock.mockRejectedValue(new Error('boom'))

    const { classifyProspectFromInbound } = await import('../classify-prospect-from-inbound')
    await expect(
      classifyProspectFromInbound({
        tenantId: 't-1',
        prospectId: 'p-1',
        prospectStage: 'novo',
        recentInboundBodies: ['oi'],
      }),
    ).resolves.toBeUndefined()
    expect(updateProspectMock).not.toHaveBeenCalled()
    expect(pushSseEventMock).not.toHaveBeenCalled()
  })

  it('does not throw when updateProspect rejects', async () => {
    procedureRowsRef.current = []
    classifyMessageMock.mockResolvedValue({
      ...baseClassification,
      interestedProcedures: [],
    })
    updateProspectMock.mockRejectedValue(new Error('db down'))

    const { classifyProspectFromInbound } = await import('../classify-prospect-from-inbound')
    await expect(
      classifyProspectFromInbound({
        tenantId: 't-1',
        prospectId: 'p-1',
        prospectStage: 'novo',
        recentInboundBodies: ['oi'],
      }),
    ).resolves.toBeUndefined()
    // SSE push is downstream of updateProspect and should not have run
    expect(pushSseEventMock).not.toHaveBeenCalled()
  })
})

describe('classifyProspectFromInbound — SSE channel routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    procedureRowsRef.current = []
    classifyMessageMock.mockReset().mockResolvedValue({
      ...baseClassification,
      interestedProcedures: [],
    })
    updateProspectMock.mockReset().mockResolvedValue(undefined)
    setProspectProceduresMock.mockReset().mockResolvedValue(undefined)
    logProspectActivityMock.mockReset().mockResolvedValue(undefined)
    pushSseEventMock.mockReset().mockResolvedValue(undefined)
  })

  it('defaults the SSE channel to "whatsapp" when channel is omitted', async () => {
    const { classifyProspectFromInbound } = await import('../classify-prospect-from-inbound')
    await classifyProspectFromInbound({
      tenantId: 't-1',
      prospectId: 'p-1',
      prospectStage: 'novo',
      recentInboundBodies: ['oi'],
    })

    expect(pushSseEventMock).toHaveBeenCalledTimes(1)
    expect(pushSseEventMock).toHaveBeenCalledWith(
      't-1',
      'prospect_updated',
      expect.objectContaining({ prospectId: 'p-1' }),
      'whatsapp',
    )
  })

  it('forwards "instagram" channel to pushSseEvent when provided', async () => {
    const { classifyProspectFromInbound } = await import('../classify-prospect-from-inbound')
    await classifyProspectFromInbound({
      tenantId: 't-1',
      prospectId: 'p-1',
      prospectStage: 'novo',
      recentInboundBodies: ['oi'],
      channel: 'instagram',
    })

    expect(pushSseEventMock).toHaveBeenCalledTimes(1)
    expect(pushSseEventMock).toHaveBeenCalledWith(
      't-1',
      'prospect_updated',
      expect.objectContaining({ prospectId: 'p-1' }),
      'instagram',
    )
  })
})
