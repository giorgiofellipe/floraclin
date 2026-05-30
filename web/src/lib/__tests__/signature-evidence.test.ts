import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock crypto.subtle for Node test env
const mockDigest = vi.fn()
beforeEach(() => {
  vi.stubGlobal('crypto', {
    subtle: { digest: mockDigest },
  })
  mockDigest.mockImplementation(async (_algo: string, data: ArrayBuffer) => {
    // Deterministic fake hash: just return first 32 bytes padded
    const view = new Uint8Array(data)
    const hash = new Uint8Array(32)
    for (let i = 0; i < Math.min(view.length, 32); i++) hash[i] = view[i]
    return hash.buffer
  })
})

describe('sha256', () => {
  it('hashes a string to a 64-char hex string', async () => {
    const { sha256 } = await import('../signature-evidence')
    const result = await sha256('hello')
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('buildEvidencePackage', () => {
  it('returns evidence object with all required fields', async () => {
    const { buildEvidencePackage } = await import('../signature-evidence')
    const result = await buildEvidencePackage({
      contentText: 'Consent text',
      signatureData: 'data:image/png;base64,abc',
      signerCpf: '123.456.789-00',
      ipAddress: '189.10.1.1',
      userAgent: 'Mozilla/5.0',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
    })

    expect(result.evidence.version).toBe(1)
    expect(result.evidence.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.evidence.signatureHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.evidence.evidenceHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.evidence.signerCpf).toBe('***.***.*89-00')
    expect(result.evidence.ipAddress).toBe('189.10.1.1')
    expect(result.evidence.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.evidence.deviceFingerprint.screen).toBe('1920x1080')
    expect(result.verificationCode).toMatch(/^FLC-[0-9A-F]{12}$/)
  })

  it('masks CPF keeping only last 6 chars visible', async () => {
    const { buildEvidencePackage } = await import('../signature-evidence')
    const result = await buildEvidencePackage({
      contentText: 'text',
      signatureData: 'data:image/png;base64,x',
      signerCpf: '987.654.321-00',
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
    })
    expect(result.evidence.signerCpf).toBe('***.***.*21-00')
  })

  it('includes geolocation when provided', async () => {
    const { buildEvidencePackage } = await import('../signature-evidence')
    const result = await buildEvidencePackage({
      contentText: 'text',
      signatureData: 'data:image/png;base64,x',
      signerCpf: '123.456.789-00',
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
      geolocation: { lat: -23.55, lng: -46.63 },
    })
    expect(result.evidence.geolocation).toEqual({ lat: -23.55, lng: -46.63 })
  })

  it('omits geolocation when not provided', async () => {
    const { buildEvidencePackage } = await import('../signature-evidence')
    const result = await buildEvidencePackage({
      contentText: 'text',
      signatureData: 'data:image/png;base64,x',
      signerCpf: '123.456.789-00',
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
    })
    expect(result.evidence.geolocation).toBeUndefined()
  })
})

describe('verifyEvidencePackage', () => {
  it('returns valid for a correctly built package', async () => {
    const { buildEvidencePackage, verifyEvidencePackage } = await import('../signature-evidence')
    const { evidence } = await buildEvidencePackage({
      contentText: 'Consent text',
      signatureData: 'data:image/png;base64,abc',
      signerCpf: '123.456.789-00',
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
    })

    const result = await verifyEvidencePackage(
      'Consent text',
      'data:image/png;base64,abc',
      evidence,
    )
    expect(result.valid).toBe(true)
  })

  it('returns invalid when content was tampered', async () => {
    const { buildEvidencePackage, verifyEvidencePackage } = await import('../signature-evidence')
    const { evidence } = await buildEvidencePackage({
      contentText: 'Original text',
      signatureData: 'data:image/png;base64,abc',
      signerCpf: '123.456.789-00',
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      deviceFingerprint: { screen: '1920x1080', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
    })

    const result = await verifyEvidencePackage(
      'Tampered text',
      'data:image/png;base64,abc',
      evidence,
    )
    expect(result.valid).toBe(false)
  })
})

describe('collectDeviceFingerprint', () => {
  it('returns screen, timezone, and language', async () => {
    vi.stubGlobal('window', {
      screen: { width: 1920, height: 1080 },
      navigator: { language: 'pt-BR' },
    })
    vi.stubGlobal('Intl', {
      DateTimeFormat: vi.fn(() => ({ resolvedOptions: () => ({ timeZone: 'America/Sao_Paulo' }) })),
    })
    const { collectDeviceFingerprint } = await import('../signature-evidence')
    const fp = collectDeviceFingerprint()
    expect(fp).toEqual({
      screen: '1920x1080',
      timezone: 'America/Sao_Paulo',
      language: 'pt-BR',
    })
  })
})

describe('deriveVerificationCode', () => {
  it('returns FLC- prefix with 12 uppercase hex chars', async () => {
    const { deriveVerificationCode } = await import('../signature-evidence')
    const code = deriveVerificationCode('abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890')
    expect(code).toBe('FLC-ABCDEF123456')
  })
})
