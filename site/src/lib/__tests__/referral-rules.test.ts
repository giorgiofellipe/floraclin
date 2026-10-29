// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { referralDiscountPercent } from '../referral-rules'

const MARKER = '// ── shared body ──'

function sharedBody(file: string): string {
  const source = readFileSync(file, 'utf8')
  const at = source.indexOf(MARKER)
  expect(at, `${file} has the shared-body marker`).toBeGreaterThanOrEqual(0)
  return source.slice(at)
}

describe('referral rules mirror', () => {
  it('site copy matches web/src/lib/referral/rules.ts below the marker', () => {
    const web = path.resolve(__dirname, '../../../../web/src/lib/referral/rules.ts')
    const site = path.resolve(__dirname, '../referral-rules.ts')
    expect(sharedBody(site)).toBe(sharedBody(web))
  })

  it('computes the discount through the site copy', () => {
    expect(referralDiscountPercent(3)).toBe(60)
    expect(referralDiscountPercent(7)).toBe(100)
  })
})
