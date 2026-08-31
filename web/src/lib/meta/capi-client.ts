import {
  META_GRAPH_VERSION,
  type MetaCapiFailure,
  type MetaCapiResult,
  type MetaCapiTarget,
  type MetaEventPayload,
} from './types'

interface GraphErrorBody {
  error?: {
    code?: number
    message?: string
    error_subcode?: number
    error_user_title?: string
    error_user_msg?: string
    /** Graph sets this on some 400s (code 2, for one) that a retry does clear. */
    is_transient?: boolean
    fbtrace_id?: string
  }
  events_received?: number
  fbtrace_id?: string
}

/**
 * Token goes in the body, never the query string: Vercel and Sentry both log
 * request URLs, and a dataset token in a log line is a credential leak.
 */
export async function postEvents(
  target: MetaCapiTarget,
  events: MetaEventPayload[],
): Promise<MetaCapiResult> {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${target.datasetId}/events`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      // Without this a hung Meta socket hangs whatever awaited the event.
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: events,
        access_token: target.accessToken,
        ...(target.testEventCode ? { test_event_code: target.testEventCode } : {}),
      }),
    })
  } catch (error) {
    return {
      ok: false,
      kind: 'transient',
      message: error instanceof Error ? error.message : 'network error',
    }
  }

  let body: GraphErrorBody = {}
  try {
    body = (await response.json()) as GraphErrorBody
  } catch {
    body = {}
  }

  const fbTraceId = body.fbtrace_id ?? body.error?.fbtrace_id

  // A 2xx alone proves nothing was accepted: an empty body, a body that is
  // not JSON, and `events_received: 0` all arrive as 200. Only a parsed count
  // above zero says Meta took the events.
  if (response.ok) {
    if (typeof body.events_received === 'number' && body.events_received > 0) {
      return { ok: true, eventsReceived: body.events_received, fbTraceId }
    }
    return {
      ok: false,
      kind: 'transient',
      message: `HTTP ${response.status} without an events_received count; the events were not accepted`,
      fbTraceId,
    }
  }

  // `error.message` is almost always the generic "Invalid parameter";
  // `error_user_msg` is the one that names the field Meta rejected.
  const failure: MetaCapiFailure = {
    ok: false,
    message: body.error?.error_user_msg ?? body.error?.message ?? `HTTP ${response.status}`,
    errorUserTitle: body.error?.error_user_title,
    errorUserMsg: body.error?.error_user_msg,
    errorSubcode: body.error?.error_subcode,
    fbTraceId,
  }

  if (response.status === 401 || response.status === 403 || body.error?.code === 190) {
    return { ...failure, kind: 'auth' }
  }
  if (response.status >= 500 || response.status === 429 || body.error?.is_transient) {
    return { ...failure, kind: 'transient' }
  }
  return { ...failure, kind: 'invalid' }
}
