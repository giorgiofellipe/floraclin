import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getAppUrl } from '../app-url'

describe('getAppUrl', () => {
  const original = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    VERCEL_URL: process.env.VERCEL_URL,
  }

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.VERCEL_URL
  })

  afterEach(() => {
    if (original.NEXT_PUBLIC_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = original.NEXT_PUBLIC_APP_URL
    if (original.VERCEL_URL === undefined) delete process.env.VERCEL_URL
    else process.env.VERCEL_URL = original.VERCEL_URL
  })

  it('prefers NEXT_PUBLIC_APP_URL when set', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.floraclin.com.br'
    process.env.VERCEL_URL = 'my-preview-123.vercel.app'

    expect(getAppUrl()).toBe('https://app.floraclin.com.br')
  })

  it('falls back to VERCEL_URL, prefixed with https://, when NEXT_PUBLIC_APP_URL is unset', () => {
    process.env.VERCEL_URL = 'my-preview-123.vercel.app'

    expect(getAppUrl()).toBe('https://my-preview-123.vercel.app')
  })

  it('falls back to localhost when neither is set', () => {
    expect(getAppUrl()).toBe('http://localhost:3000')
  })
})
