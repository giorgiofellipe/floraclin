import { cookieConsentStatus } from '@/lib/cookie-consent'

/**
 * Optional analytics (persistent identity, autocapture, session replay,
 * heatmaps) rides on the same choice as the Meta pixel: the "marketing" opt-in
 * of the cookie banner. Without it PostHog runs cookieless, see client.ts.
 */
export function analyticsConsentGranted(): boolean {
  return cookieConsentStatus() === 'granted'
}

// posthog-js names everything it stores `ph_<key>_...` (persistence, window
// id) or `__ph_opt_in_out_<key>`; `ph_debug` too.
function isPostHogKey(name: string): boolean {
  return name.startsWith('ph_') || name.startsWith('__ph_')
}

/**
 * Removes whatever PostHog stored while consent was granted: its
 * localStorage/sessionStorage entries and its cookie, which posthog-js sets on
 * the registrable domain (`.floraclin.com.br`) as well as the bare host.
 */
export function clearPostHogStorage(): void {
  if (typeof window === 'undefined') return

  for (const storage of [safeStorage('localStorage'), safeStorage('sessionStorage')]) {
    if (!storage) continue
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && isPostHogKey(key)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  }

  const names = document.cookie
    .split(';')
    .map((part) => part.split('=')[0]?.trim())
    .filter((name): name is string => !!name && isPostHogKey(name))
  for (const name of names) {
    for (const domain of cookieDomains(window.location.hostname)) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ''}`
    }
  }
}

function safeStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return window[kind]
  } catch {
    return null
  }
}

// '' (host-only) plus every parent domain with at least two labels:
// app.floraclin.com.br → '', '.app.floraclin.com.br', '.floraclin.com.br', '.com.br'.
function cookieDomains(hostname: string): string[] {
  const labels = hostname.split('.')
  const domains = ['']
  for (let i = 0; i <= labels.length - 2; i++) domains.push(`.${labels.slice(i).join('.')}`)
  return domains
}
