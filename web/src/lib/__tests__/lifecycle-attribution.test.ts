import { describe, expect, it } from 'vitest'
import { isLikelyLinkScanner } from '@/lib/lifecycle-attribution'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const sentAt = new Date('2026-10-16T12:00:00.000Z')
const after = (ms: number) => new Date(sentAt.getTime() + ms)

describe('isLikelyLinkScanner', () => {
  it.each<[string, string | null, Date, boolean]>([
    ['a browser well after the send', CHROME, after(5 * 60_000), false],
    ['a browser within the first minute (mail gateway pre-fetch)', CHROME, after(20_000), true],
    ['Outlook Safe Links', 'Microsoft Office SafeLinks/1.0', after(5 * 60_000), true],
    ['a generic bot', 'Mozilla/5.0 (compatible; Googlebot/2.1)', after(5 * 60_000), true],
    ['no user agent', null, after(5 * 60_000), true],
  ])('%s', (_name, userAgent, now, expected) => {
    expect(isLikelyLinkScanner(userAgent, sentAt, now)).toBe(expected)
  })
})
