import { buildFbc } from '@/lib/marketing-attribution'
import type { FirstTouch } from '@/lib/first-touch'

export interface MetaBrowserSignals {
  clientIp?: string
  userAgent?: string
  fbc?: string
  fbp?: string
}

type CookieGetter = (name: string) => string | undefined

/** IP, user agent and Meta browser ids of the request, the match keys Meta wants on a website event. */
export function metaBrowserSignals(
  headers: Pick<Headers, 'get'>,
  cookie: CookieGetter,
  firstTouch?: FirstTouch | null,
): MetaBrowserSignals {
  const builtFbc = firstTouch?.fbclid ? buildFbc(firstTouch.fbclid, Date.parse(firstTouch.capturedAt)) : undefined
  return withoutEmpty({
    clientIp: clientIp(headers),
    userAgent: headers.get('user-agent') ?? undefined,
    fbc: cookie('_fbc') ?? builtFbc,
    fbp: cookie('_fbp'),
  })
}

export function cookieFromHeader(headers: Pick<Headers, 'get'>): CookieGetter {
  const pairs = (headers.get('cookie') ?? '').split(';').map((part) => part.trim().split('='))
  return (name) => {
    const value = pairs.find(([key]) => key === name)?.slice(1).join('=')
    return value ? decodeURIComponent(value) : undefined
  }
}

function clientIp(headers: Pick<Headers, 'get'>): string | undefined {
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwardedFor || headers.get('x-real-ip')?.trim() || undefined
}

function withoutEmpty(signals: MetaBrowserSignals): MetaBrowserSignals {
  return Object.fromEntries(Object.entries(signals).filter(([, value]) => value)) as MetaBrowserSignals
}
