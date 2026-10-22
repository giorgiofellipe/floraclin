import { describe, expect, it } from 'vitest'
import { isLikelyLinkScanner, lifecycleDestination, type LifecycleClickRequest } from '@/lib/lifecycle-attribution'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

const WHATSAPP_ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 WhatsApp/2.24.21.80'

const get = (userAgent: string | null, prefetchHeader: string | null = null): LifecycleClickRequest => ({ method: 'GET', userAgent, prefetchHeader })
const head = (userAgent: string | null): LifecycleClickRequest => ({ method: 'HEAD', userAgent, prefetchHeader: null })
const email = { channel: 'email' as const }
const whatsapp = { channel: 'whatsapp' as const }

describe('isLikelyLinkScanner', () => {
  it.each<[string, string]>([
    ['desktop Chrome', CHROME],
    ['iOS Mail handing off to Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'],
    ['the Gmail app on Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 GSA/15.40.33.29.arm64'],
    ['Outlook on iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Outlook-iOS/730.4285929.prod.iphone (4.2425.0)'],
    ['Edge', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0'],
    ['Samsung Internet', 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36'],
    ['a phone model containing "bot"', 'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'],
  ])('email: counts a person on %s', (_name, userAgent) => {
    expect(isLikelyLinkScanner(get(userAgent), email)).toBe(false)
  })

  it.each<[string, LifecycleClickRequest]>([
    ['Outlook Safe Links', get('Microsoft Office SafeLinks/1.0')],
    ['Office existence discovery', get('Microsoft Office Existence Discovery')],
    ['Mimecast', get('Mozilla/5.0 (compatible; Mimecast URL Protect)')],
    ['Gmail image proxy', get('Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)')],
    ['a generic bot', get('Mozilla/5.0 (compatible; Googlebot/2.1)')],
    ['no user agent', get(null)],
    ['a HEAD request with a browser user agent', head(CHROME)],
    ['a browser prefetch', get(CHROME, 'prefetch')],
    ['a speculation-rules prerender', get(CHROME, 'prefetch;prerender')],
    ['a Safari preview', get(CHROME, 'preview')],
  ])('email: flags %s', (_name, req) => {
    expect(isLikelyLinkScanner(req, email)).toBe(true)
  })

  it('never flags a WhatsApp send, whatever the request looks like', () => {
    for (const req of [get(WHATSAPP_ANDROID_WEBVIEW), get('WhatsApp/2.24.21.80 A'), get(null), head(CHROME)]) {
      expect(isLikelyLinkScanner(req, whatsapp)).toBe(false)
    }
  })
})

describe('lifecycleDestination', () => {
  it('tags app links with UTM params', () => {
    const url = lifecycleDestination({ messageKey: 'trial_winback', channel: 'email' })
    expect(url.pathname).toBe('/configuracoes')
    expect(url.searchParams.get('utm_campaign')).toBe('trial_winback')
  })

  it('sends the help email straight to the support WhatsApp, query string untouched', () => {
    const url = lifecycleDestination({ messageKey: 'trial_help', channel: 'email' })
    expect(url.host).toBe('wa.me')
    expect(url.searchParams.get('text')).toMatch(/ajuda/)
    expect(url.searchParams.has('utm_source')).toBe(false)
  })
})
