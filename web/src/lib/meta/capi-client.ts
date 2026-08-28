import {
  META_GRAPH_VERSION,
  type MetaCapiResult,
  type MetaCapiTarget,
  type MetaEventPayload,
} from './types'

interface GraphErrorBody {
  error?: { code?: number; message?: string; fbtrace_id?: string }
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

  if (response.ok) {
    return { ok: true, eventsReceived: body.events_received ?? events.length, fbTraceId }
  }

  const message = body.error?.message ?? `HTTP ${response.status}`

  if (response.status === 401 || response.status === 403 || body.error?.code === 190) {
    return { ok: false, kind: 'auth', message, fbTraceId }
  }
  if (response.status >= 500 || response.status === 429) {
    return { ok: false, kind: 'transient', message, fbTraceId }
  }
  return { ok: false, kind: 'invalid', message, fbTraceId }
}
