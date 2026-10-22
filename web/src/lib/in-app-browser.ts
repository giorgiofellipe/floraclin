/**
 * Google refuses OAuth inside embedded web views (error 403
 * `disallowed_useragent`), and the apps people open our links from, WhatsApp
 * and Instagram first among them, load links in exactly such a view. A
 * Google-only account tapping "Continuar com Google" there hits a Google error
 * page and has no other way in, so /login and /signup need to know before the
 * tap.
 *
 * Matched on the tokens each app adds to its user agent. Chat apps' link
 * preview fetchers send the same token without a browser prefix; those never
 * render a page, so only browser user agents are classified here.
 */
export type InAppBrowserApp =
  | 'whatsapp'
  | 'instagram'
  | 'facebook'
  | 'messenger'
  | 'tiktok'
  | 'linkedin'
  | 'line'
  | 'telegram'
  | 'snapchat'
  | 'twitter'
  | 'threads'
  | 'pinterest'
  | 'webview'

export type InAppBrowser = { app: InAppBrowserApp; os: 'android' | 'ios' | 'other' }

// Order matters: Threads (`Barcelona`) also sends the Instagram token, Messenger also sends the FBAN/FBAV tokens Facebook does, and
// Instagram's Android build can carry Facebook tokens too.
const APPS: [InAppBrowserApp, RegExp][] = [
  ['threads', /\bBarcelona\b/],
  ['instagram', /\bInstagram\b/i],
  ['messenger', /\bFB_IAB\/MESSENGER|\bFBAN\/Messenger|\bMessengerForiOS|\bMessengerLite/i],
  ['facebook', /\bFBAN\/|\bFBAV\/|\bFB_IAB\/|\bFBIOS\b|\bFB4A\b/i],
  ['whatsapp', /\bWhatsApp\b/i],
  ['tiktok', /\bmusical_ly|\bBytedanceWebview|\bTikTok\b|\bTrill\b/i],
  ['linkedin', /\bLinkedInApp\b/i],
  ['line', /\bLine\/\d/i],
  ['telegram', /\bTelegram\b/i],
  ['snapchat', /\bSnapchat\b/i],
  ['twitter', /\bTwitter(?:Android)?\b/i],
  ['pinterest', /\bPinterest\b/i],
]

/** "dentro do WhatsApp": the phrase the in-app modal reads with. */
export const IN_APP_BROWSER_PLACE: Record<InAppBrowserApp, string> = {
  whatsapp: 'do WhatsApp',
  instagram: 'do Instagram',
  facebook: 'do Facebook',
  messenger: 'do Messenger',
  tiktok: 'do TikTok',
  linkedin: 'do LinkedIn',
  line: 'do LINE',
  telegram: 'do Telegram',
  snapchat: 'do Snapchat',
  twitter: 'do X',
  threads: 'do Threads',
  pinterest: 'do Pinterest',
  webview: 'deste aplicativo',
}

function osOf(userAgent: string): InAppBrowser['os'] {
  if (/\bAndroid\b/i.test(userAgent)) return 'android'
  if (/\b(iPhone|iPad|iPod)\b/i.test(userAgent)) return 'ios'
  return 'other'
}

export function detectInAppBrowser(userAgent: string | null | undefined): InAppBrowser | null {
  if (!userAgent || !/^Mozilla\//.test(userAgent)) return null
  const os = osOf(userAgent)
  for (const [app, pattern] of APPS) {
    if (pattern.test(userAgent)) return { app, os }
  }
  // Android's system WebView marks itself with `; wv)`, which is also what
  // Google's block keys on. Chrome Custom Tabs, which Google allows, do not.
  // There is no iOS equivalent worth trusting: a home-screen web app also
  // lacks the Safari token, and Google sign-in works there.
  if (os === 'android' && /;\s*wv\)/.test(userAgent)) return { app: 'webview', os }
  return null
}

/**
 * Android hands a tapped intent:// link to the system, which opens Chrome at
 * the same address. Returns null off Android, where no such link exists.
 */
export function chromeIntentUrl(href: string, os: InAppBrowser['os']): string | null {
  if (os !== 'android') return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const scheme = url.protocol.slice(0, -1)
  const fallback = encodeURIComponent(url.toString())
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${fallback};end`
}
