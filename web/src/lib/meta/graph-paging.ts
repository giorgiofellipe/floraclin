import { META_GRAPH_VERSION } from '@/lib/meta/types'

/**
 * An agency token can see dozens of portfolios and a portfolio dozens of
 * pixels. Reading only the first page hides the clinic's own item and, for
 * datasets, blocks the OAuth flow outright, so both pickers walk `paging.next`.
 */
export const MAX_GRAPH_PAGES = 10

/** Graph caps `limit` at a few hundred; 100 keeps the walk short in practice. */
export const GRAPH_PAGE_SIZE = 100

interface GraphPage<T> {
  data?: T[]
  paging?: { next?: string }
  error?: { message?: string }
}

export type GraphListResult<T> =
  | { ok: true; items: T[]; truncated: boolean }
  | { ok: false; message: string }

/**
 * Graph echoes the token back inside `paging.next` as a query parameter, and
 * Vercel and Sentry both log request URLs. Strip it, and refuse a `next` that
 * points anywhere but the pinned Graph version, so a malformed response cannot
 * redirect the walk.
 */
function sanitizeNextUrl(next: string): string | null {
  let url: URL
  try {
    url = new URL(next)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' || url.hostname !== 'graph.facebook.com') return null
  if (!url.pathname.startsWith(`/${META_GRAPH_VERSION}/`)) return null

  url.searchParams.delete('access_token')
  return url.toString()
}

export async function fetchGraphList<T>(
  firstUrl: string,
  accessToken: string,
): Promise<GraphListResult<T>> {
  // One deadline for the whole walk rather than one per page: ten pages at ten
  // seconds each would hang the settings page for over a minute.
  const signal = AbortSignal.timeout(10_000)
  const items: T[] = []
  let url = firstUrl

  for (let page = 0; page < MAX_GRAPH_PAGES; page++) {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        signal,
        // Never in the URL: Vercel and Sentry both log request URLs.
        headers: { authorization: `Bearer ${accessToken}` },
      })
    } catch (error) {
      // A timeout partway through still leaves a usable list. Only a first
      // page that never arrived is a failure worth reporting.
      if (items.length > 0) return { ok: true, items, truncated: true }
      throw error
    }

    const body = (await response.json().catch(() => ({}))) as GraphPage<T>

    if (!response.ok) {
      if (items.length > 0) return { ok: true, items, truncated: true }
      return { ok: false, message: body.error?.message ?? `HTTP ${response.status}` }
    }

    items.push(...(body.data ?? []))

    const next = body.paging?.next ? sanitizeNextUrl(body.paging.next) : null
    if (!next) return { ok: true, items, truncated: false }
    url = next
  }

  return { ok: true, items, truncated: true }
}
