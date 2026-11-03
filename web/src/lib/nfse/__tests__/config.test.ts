import { afterEach, describe, expect, it, vi } from 'vitest'
import { nfseEnvironment } from '../config'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('nfseEnvironment', () => {
  it('throws when unset in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NFSE_NACIONAL_ENVIRONMENT', '')
    expect(() => nfseEnvironment()).toThrow(/NFSE_NACIONAL_ENVIRONMENT/)
  })

  it('defaults to restricted outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('NFSE_NACIONAL_ENVIRONMENT', '')
    expect(nfseEnvironment()).toBe('restricted')
  })

  it('returns the configured value', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NFSE_NACIONAL_ENVIRONMENT', 'production')
    expect(nfseEnvironment()).toBe('production')
  })

  it('rejects an unknown value', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('NFSE_NACIONAL_ENVIRONMENT', 'prod')
    expect(() => nfseEnvironment()).toThrow(/NFSE_NACIONAL_ENVIRONMENT/)
  })
})
