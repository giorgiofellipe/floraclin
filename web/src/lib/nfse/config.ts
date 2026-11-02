import type { NfseEnvironment } from './types'

export const NFSE_DPS_SERIES = '00800'
export const NFSE_APP_VERSION = 'floraclin'
export const NFSE_CLOCK_SKEW_MS = 60_000

const ENVIRONMENTS: readonly NfseEnvironment[] = ['production', 'restricted']

export function nfseEnvironment(): NfseEnvironment {
  const value = process.env.NFSE_NACIONAL_ENVIRONMENT
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NFSE_NACIONAL_ENVIRONMENT must be set in production')
    }
    return 'restricted'
  }
  if (!ENVIRONMENTS.includes(value as NfseEnvironment)) {
    throw new Error(`NFSE_NACIONAL_ENVIRONMENT must be "production" or "restricted", got "${value}"`)
  }
  return value as NfseEnvironment
}
