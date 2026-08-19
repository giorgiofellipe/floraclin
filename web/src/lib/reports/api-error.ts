import type { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-error'

/**
 * `catch` handler for the routes under `/api/reports`.
 *
 * Same contract as {@link handleApiError}. It only adds the two tags that
 * make a report failure triageable. `format` is the single most useful
 * discriminator here: the JSON and PDF branches of these routes share auth and
 * the data query but diverge completely afterwards, so knowing which one blew
 * up narrows it to headless-Chromium rendering vs everything else immediately.
 */
export function reportRouteError(error: unknown, request?: Request): NextResponse {
  let format: string | undefined
  if (request) {
    try {
      format = new URL(request.url).searchParams.get('format') ?? 'json'
    } catch {
      // A malformed request URL is not worth losing the error report over.
    }
  }

  return handleApiError(error, request, { tags: { area: 'reports', format } })
}
