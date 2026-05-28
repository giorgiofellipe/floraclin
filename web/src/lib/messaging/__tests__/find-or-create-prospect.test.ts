import { describe, it, expect, vi } from 'vitest'
import { findOrCreateProspect } from '../find-or-create-prospect'

type TestProspect = { id: string; stage: string }

describe('findOrCreateProspect — reuses non-terminal existing prospect', () => {
  it('reuses an existing prospect with stage "novo"', async () => {
    const existing: TestProspect = { id: 'p-existing', stage: 'novo' }
    const fresh: TestProspect = { id: 'p-fresh', stage: 'novo' }
    const lookup = vi.fn().mockResolvedValue(existing)
    const createNew = vi.fn().mockResolvedValue(fresh)

    const result = await findOrCreateProspect({ lookup, createNew })

    expect(result).toEqual({ prospect: existing, created: false })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(createNew).not.toHaveBeenCalled()
  })

  it.each(['novo', 'contatado', 'interessado', 'agendado'])(
    'reuses an existing prospect with non-terminal stage "%s"',
    async (stage) => {
      const existing: TestProspect = { id: 'p-existing', stage }
      const fresh: TestProspect = { id: 'p-fresh', stage: 'novo' }
      const lookup = vi.fn().mockResolvedValue(existing)
      const createNew = vi.fn().mockResolvedValue(fresh)

      const result = await findOrCreateProspect({ lookup, createNew })

      expect(result).toEqual({ prospect: existing, created: false })
      expect(createNew).not.toHaveBeenCalled()
    },
  )
})

describe('findOrCreateProspect — creates new prospect on terminal stage', () => {
  it('creates a new prospect when existing stage is "convertido"', async () => {
    const existing: TestProspect = { id: 'p-existing', stage: 'convertido' }
    const fresh: TestProspect = { id: 'p-fresh', stage: 'novo' }
    const lookup = vi.fn().mockResolvedValue(existing)
    const createNew = vi.fn().mockResolvedValue(fresh)

    const result = await findOrCreateProspect({ lookup, createNew })

    expect(result).toEqual({ prospect: fresh, created: true })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(createNew).toHaveBeenCalledTimes(1)
  })

  it('creates a new prospect when existing stage is "perdido"', async () => {
    const existing: TestProspect = { id: 'p-existing', stage: 'perdido' }
    const fresh: TestProspect = { id: 'p-fresh', stage: 'novo' }
    const lookup = vi.fn().mockResolvedValue(existing)
    const createNew = vi.fn().mockResolvedValue(fresh)

    const result = await findOrCreateProspect({ lookup, createNew })

    expect(result).toEqual({ prospect: fresh, created: true })
    expect(createNew).toHaveBeenCalledTimes(1)
  })
})

describe('findOrCreateProspect — creates new prospect when none exists', () => {
  it('creates a new prospect when lookup returns null', async () => {
    const fresh: TestProspect = { id: 'p-fresh', stage: 'novo' }
    const lookup = vi.fn().mockResolvedValue(null)
    const createNew = vi.fn().mockResolvedValue(fresh)

    const result = await findOrCreateProspect({ lookup, createNew })

    expect(result).toEqual({ prospect: fresh, created: true })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(createNew).toHaveBeenCalledTimes(1)
  })
})

describe('findOrCreateProspect — error propagation', () => {
  it('propagates errors thrown by lookup (no swallow)', async () => {
    const lookupErr = new Error('lookup failed')
    const lookup = vi.fn().mockRejectedValue(lookupErr)
    const createNew = vi.fn()

    await expect(findOrCreateProspect({ lookup, createNew })).rejects.toThrow(
      'lookup failed',
    )
    expect(createNew).not.toHaveBeenCalled()
  })

  it('propagates errors thrown by createNew', async () => {
    const createErr = new Error('create failed')
    const lookup = vi.fn().mockResolvedValue(null)
    const createNew = vi.fn().mockRejectedValue(createErr)

    await expect(findOrCreateProspect({ lookup, createNew })).rejects.toThrow(
      'create failed',
    )
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(createNew).toHaveBeenCalledTimes(1)
  })
})
