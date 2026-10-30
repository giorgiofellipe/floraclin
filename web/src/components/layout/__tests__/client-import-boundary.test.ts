import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// These modules ship to the browser. A server-only import here would only
// fail at build time (which needs env), so the rule is checked statically.
const CLIENT_FILES = ['subscription-access.tsx', 'plan-checkout.tsx', 'expired-paywall.tsx', 'trial-ending-modal.tsx']

const dir = join(__dirname, '..')

function importsOf(source: string): { spec: string; typeOnly: boolean }[] {
  const out: { spec: string; typeOnly: boolean }[] = []
  for (const m of source.matchAll(/^\s*import\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    out.push({ spec: m[3], typeOnly: !!m[1] })
  }
  for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push({ spec: m[1], typeOnly: false })
  return out
}

describe('client import boundary', () => {
  it.each(CLIENT_FILES)('%s imports nothing server-only', (file) => {
    const source = readFileSync(join(dir, file), 'utf8')
    expect(source.startsWith("'use client'")).toBe(true)
    for (const { spec, typeOnly } of importsOf(source)) {
      expect(spec, `${file}: ${spec}`).not.toBe('@/lib/referral/offer')
      expect(spec, `${file}: ${spec}`).not.toBe('@/lib/referral/config')
      expect(spec, `${file}: ${spec}`).not.toBe('@/lib/feedback-offer')
      expect(spec.startsWith('@/db'), `${file}: ${spec}`).toBe(false)
      if (spec === '@/lib/stripe') expect(typeOnly, `${file}: value import of ${spec}`).toBe(true)
    }
  })

  it.each(CLIENT_FILES)('%s takes referralOfferHeadline from offer-copy', (file) => {
    const source = readFileSync(join(dir, file), 'utf8')
    if (!source.includes('referralOfferHeadline')) return
    const from = [...source.matchAll(/^\s*import\s+[^'"]*?\breferralOfferHeadline\b[^'"]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(from).toEqual(['@/lib/referral/offer-copy'])
  })
})
