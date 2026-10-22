import { describe, expect, it } from 'vitest'
import { chromeIntentUrl, detectInAppBrowser } from '@/lib/in-app-browser'

// Real user agents, as each app sends them from its embedded browser.
const UA = {
  whatsappAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 WhatsApp/2.24.21.80',
  whatsappIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.21.80',
  instagramIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.32.97 (iPhone15,2; iOS 17_5; pt_BR; pt; scale=3.00; 1179x2556; 634108168)',
  instagramAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Instagram 345.0.0.48.95 Android (34/14; 480dpi; 1080x2340; samsung; SM-S918B; dm3q; qcom; pt_BR; 634108168)',
  facebookIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/476.0.0.49.106;FBBV/634960374;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/pt_BR;FBOP/80]',
  facebookAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.58.109;]',
  messengerAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/470.0.0.40.109;]',
  tiktokAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 musical_ly_2023607030 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/36.7.3 ByteLocale/pt-BR',
  linkedinIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1234',
  lineIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0',
  threadsIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Barcelona 289.0.0.77.109 (iPhone15,2; iOS 17_5; pt_BR; pt; scale=3.00; 1179x2556; 634108168)',
  pinterestIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]',
  genericAndroidWebview:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.100 Mobile Safari/537.36',
  safariIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  iosHomeScreenApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  desktopChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
}

describe('detectInAppBrowser', () => {
  it.each([
    ['whatsappAndroid', 'whatsapp', 'android'],
    ['whatsappIos', 'whatsapp', 'ios'],
    ['instagramIos', 'instagram', 'ios'],
    ['instagramAndroid', 'instagram', 'android'],
    ['facebookIos', 'facebook', 'ios'],
    ['facebookAndroid', 'facebook', 'android'],
    ['messengerAndroid', 'messenger', 'android'],
    ['tiktokAndroid', 'tiktok', 'android'],
    ['linkedinIos', 'linkedin', 'ios'],
    ['lineIos', 'line', 'ios'],
    ['threadsIos', 'threads', 'ios'],
    ['pinterestIos', 'pinterest', 'ios'],
    ['genericAndroidWebview', 'webview', 'android'],
  ] as const)('recognises %s', (key, app, os) => {
    expect(detectInAppBrowser(UA[key])).toEqual({ app, os })
  })

  it.each(['chromeAndroid', 'safariIos', 'chromeIos', 'iosHomeScreenApp', 'desktopChrome'] as const)(
    'leaves a real browser alone: %s',
    (key) => {
      expect(detectInAppBrowser(UA[key])).toBeNull()
    },
  )

  it("ignores WhatsApp's link preview fetcher, which never renders the page", () => {
    expect(detectInAppBrowser('WhatsApp/2.24.21.80 A')).toBeNull()
  })

  it('ignores a missing user agent', () => {
    expect(detectInAppBrowser(null)).toBeNull()
  })
})

describe('chromeIntentUrl', () => {
  it('opens the same address in Chrome on Android, falling back to the page itself', () => {
    const href = 'https://app.floraclin.com.br/login?callbackUrl=%2Fonboarding'
    expect(chromeIntentUrl(href, 'android')).toBe(
      'intent://app.floraclin.com.br/login?callbackUrl=%2Fonboarding#Intent;scheme=https;package=com.android.chrome;' +
        `S.browser_fallback_url=${encodeURIComponent(href)};end`,
    )
  })

  it('has nothing to offer off Android', () => {
    expect(chromeIntentUrl('https://app.floraclin.com.br/login', 'ios')).toBeNull()
  })

  it('refuses anything that is not http(s)', () => {
    expect(chromeIntentUrl('javascript:alert(1)', 'android')).toBeNull()
  })
})
