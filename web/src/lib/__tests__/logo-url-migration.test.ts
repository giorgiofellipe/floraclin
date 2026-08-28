/**
 * The migration behind these cases rewrites `tenants.logo_url` in place, so
 * the parser has exactly one job it must not get wrong: never claim a path it
 * did not actually recover. A row it cannot read has to come back as
 * `unparseable` so the script reports it and leaves it alone.
 */
import { describe, it, expect } from 'vitest'
import { parseLogoUrl } from '@/lib/logo-url-migration'

describe('parseLogoUrl', () => {
  it('recovers the storage path from a Supabase signed URL', () => {
    expect(
      parseLogoUrl(
        'https://xyz.supabase.co/storage/v1/object/sign/floraclin/tenant-1/branding/logo-abc.png?token=eyJhbG',
      ),
    ).toEqual({ kind: 'converted', path: 'tenant-1/branding/logo-abc.png' })
  })

  it('decodes percent-encoded path segments', () => {
    expect(
      parseLogoUrl(
        'https://xyz.supabase.co/storage/v1/object/sign/floraclin/tenant-1/branding/logo%20final.png?token=t',
      ),
    ).toEqual({ kind: 'converted', path: 'tenant-1/branding/logo final.png' })
  })

  it('ignores the query string entirely', () => {
    const parsed = parseLogoUrl(
      'https://xyz.supabase.co/storage/v1/object/sign/floraclin/t/branding/l.svg?token=a&download=b',
    )
    expect(parsed).toEqual({ kind: 'converted', path: 't/branding/l.svg' })
  })

  it('leaves a value that is already a bare path alone, so a re-run is a no-op', () => {
    expect(parseLogoUrl('tenant-1/branding/logo-abc.png')).toEqual({ kind: 'already-path' })
  })

  it('reports a URL from a different bucket rather than converting it', () => {
    const parsed = parseLogoUrl(
      'https://xyz.supabase.co/storage/v1/object/sign/other-bucket/tenant-1/logo.png?token=t',
    )
    expect(parsed.kind).toBe('unparseable')
  })

  it('reports a public (unsigned) storage URL rather than converting it', () => {
    const parsed = parseLogoUrl(
      'https://xyz.supabase.co/storage/v1/object/public/floraclin/tenant-1/logo.png',
    )
    expect(parsed.kind).toBe('unparseable')
  })

  it('reports an http URL that is not a storage URL at all', () => {
    const parsed = parseLogoUrl('https://cdn.example.com/logos/clinica.png')
    expect(parsed.kind).toBe('unparseable')
  })

  it('reports a malformed URL', () => {
    expect(parseLogoUrl('https://').kind).toBe('unparseable')
  })

  it('reports an empty value', () => {
    expect(parseLogoUrl('   ').kind).toBe('unparseable')
  })

  it('always explains why a row could not be converted', () => {
    const parsed = parseLogoUrl('https://cdn.example.com/logos/clinica.png')
    expect(parsed.kind === 'unparseable' && parsed.reason.length > 0).toBe(true)
  })
})
