import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { decryptSecret, encryptIfPlaintext, encryptSecret, isEncryptedSecret } from '../crypto'

const KEY = 'a'.repeat(64)
const OTHER_KEY = 'b'.repeat(64)

describe('encryptSecret / decryptSecret', () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY
  })

  afterEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY
  })

  it('round trips a token', () => {
    const token = 'EAABsbCS1iZAIBAO-a-long-lived-meta-token'

    expect(decryptSecret(encryptSecret(token))).toBe(token)
  })

  it('round trips the empty string and non-ASCII text', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('')
    expect(decryptSecret(encryptSecret('acentuação ✓'))).toBe('acentuação ✓')
  })

  it('never produces the same ciphertext twice for the same input', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('carries the version, so the format can change later', () => {
    expect(encryptSecret('tok').startsWith('v1.')).toBe(true)
  })

  // Rows written before this shipped are plaintext, and the code deploys
  // before the backfill runs. Without this, every existing connection breaks.
  it('passes a value that is not in the encrypted format straight through', () => {
    for (const plaintext of [
      'ya29.a0AfB_byGoogleAccessToken',
      'EAABsbCS1iZAIBAO',
      '1//04refresh-token_with-dots.and-dashes',
      'v1.too.few.parts.but-wrong-lengths',
      '',
    ]) {
      expect(decryptSecret(plaintext)).toBe(plaintext)
    }
  })

  it('fails rather than returning garbage when the ciphertext was tampered with', () => {
    const encrypted = encryptSecret('a-real-token')
    const [version, iv, tag, ciphertext] = encrypted.split('.')
    const flip = (part: string) => (part.startsWith('A') ? `B${part.slice(1)}` : `A${part.slice(1)}`)

    expect(() => decryptSecret([version, iv, tag, flip(ciphertext)].join('.'))).toThrow()
    expect(() => decryptSecret([version, flip(iv), tag, ciphertext].join('.'))).toThrow()
    expect(() => decryptSecret([version, iv, flip(tag), ciphertext].join('.'))).toThrow()
  })

  it('fails when decrypted with a different key', () => {
    const encrypted = encryptSecret('a-real-token')
    process.env.TOKEN_ENCRYPTION_KEY = OTHER_KEY

    expect(() => decryptSecret(encrypted)).toThrow()
  })

  it('refuses to run without a key, naming the variable', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY

    expect(() => encryptSecret('tok')).toThrow(/TOKEN_ENCRYPTION_KEY is not set/)
  })

  it('refuses a key that is not 32 bytes of hex', () => {
    for (const bad of ['a'.repeat(32), 'a'.repeat(65), 'z'.repeat(64)]) {
      process.env.TOKEN_ENCRYPTION_KEY = bad
      expect(() => encryptSecret('tok')).toThrow(/64 hexadecimal characters/)
    }
  })

  // A missing key must not silently turn into "leave it in plaintext".
  it('does not need a key to pass plaintext through, but needs one to read ciphertext', () => {
    const encrypted = encryptSecret('tok')
    delete process.env.TOKEN_ENCRYPTION_KEY

    expect(decryptSecret('ya29.plaintext')).toBe('ya29.plaintext')
    expect(() => decryptSecret(encrypted)).toThrow(/TOKEN_ENCRYPTION_KEY is not set/)
  })
})

describe('isEncryptedSecret', () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY
  })

  it('recognizes its own output', () => {
    expect(isEncryptedSecret(encryptSecret('tok'))).toBe(true)
  })

  it('does not mistake a real token for one', () => {
    expect(isEncryptedSecret('ya29.a0AfB_byGoogleAccessToken')).toBe(false)
    expect(isEncryptedSecret('1//04refresh.token.with.dots')).toBe(false)
    expect(isEncryptedSecret('v1.short.tag.data')).toBe(false)
  })
})

describe('encryptIfPlaintext', () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY
  })

  // The backfill is safe to re-run: a second pass rewrites nothing.
  it('is idempotent', () => {
    const once = encryptIfPlaintext('a-real-token')
    const twice = encryptIfPlaintext(once)

    expect(twice).toBe(once)
    expect(decryptSecret(twice)).toBe('a-real-token')
  })

  it('encrypts a plaintext value', () => {
    const result = encryptIfPlaintext('a-real-token')

    expect(result).not.toBe('a-real-token')
    expect(decryptSecret(result)).toBe('a-real-token')
  })
})
