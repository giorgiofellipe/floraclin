import { BusinessError } from '@/lib/errors'

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0'

function getPlatformCredentials() {
  const phoneNumberId = process.env.FLORACLIN_WA_PHONE_NUMBER_ID
  const accessToken = process.env.FLORACLIN_WA_ACCESS_TOKEN
  const businessAccountId = process.env.FLORACLIN_WA_BUSINESS_ACCOUNT_ID
  if (!phoneNumberId || !accessToken || !businessAccountId)
    throw new BusinessError(
      'WHATSAPP_NOT_CONFIGURED',
      'WhatsApp da FloraClin não configurado neste ambiente (FLORACLIN_WA_*).',
    )
  return { phoneNumberId, accessToken, businessAccountId }
}

async function platformFetch(path: string, token: string, body: unknown) {
  const res = await fetch(`${GRAPH_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const data = await res.json()
  if (!res.ok) {
    const err = data?.error
    const details = [err?.message, err?.code && `code=${err.code}`].filter(Boolean).join(' | ')
    throw new Error(`Meta API error: ${details || 'Unknown error'}`)
  }
  return data
}

export async function sendPlatformTemplate(
  to: string,
  templateName: string,
  bodyParams: string[],
  opts?: { buttonUrlParams?: string[] },
): Promise<{ metaMessageId: string }> {
  const creds = getPlatformCredentials()
  const components = [
    ...(bodyParams.length > 0
      ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }]
      : []),
    ...(opts?.buttonUrlParams ?? []).map((text, index) => ({
      type: 'button',
      sub_type: 'url',
      index: String(index),
      parameters: [{ type: 'text', text }],
    })),
  ]
  const data = await platformFetch(`/${creds.phoneNumberId}/messages`, creds.accessToken, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'pt_BR' },
      ...(components.length > 0 && { components }),
    },
  })
  const metaMessageId = data?.messages?.[0]?.id as string | undefined
  if (!metaMessageId) throw new Error('Meta API error: missing message id')
  return { metaMessageId }
}

export async function createPlatformTemplate(def: {
  name: string
  category: 'UTILITY' | 'MARKETING'
  language: string
  components: unknown[]
}): Promise<{ id: string; status: string }> {
  const creds = getPlatformCredentials()
  const data = await platformFetch(
    `/${creds.businessAccountId}/message_templates`,
    creds.accessToken,
    def,
  )
  return data as { id: string; status: string }
}

export interface PlatformTemplateStatus {
  id: string
  name: string
  status: string
  category: string
  rejectedReason: string | null
}

/** The pt_BR template with exactly this name on the platform WABA, or null when Meta has none. */
export async function findPlatformTemplate(name: string): Promise<PlatformTemplateStatus | null> {
  const creds = getPlatformCredentials()
  const params = new URLSearchParams({
    name,
    fields: 'id,name,status,category,language,rejected_reason',
    // `name` is a prefix filter and results are paginated; widen the page so
    // the exact match isn't pushed past the first page by similar names.
    // Only this first page (100 prefix matches) is checked.
    limit: '100',
  })
  const res = await fetch(`${GRAPH_API_BASE}/${creds.businessAccountId}/message_templates?${params}`, {
    headers: { Authorization: `Bearer ${creds.accessToken}` },
    signal: AbortSignal.timeout(10_000),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = data?.error
    const details = [err?.message, err?.code && `code=${err.code}`].filter(Boolean).join(' | ')
    throw new Error(`Meta API error: ${details || 'Unknown error'}`)
  }
  // A malformed 2xx must throw, not read as "missing": callers treat null as
  // not approved, while a throw lets them fail open as status unknown.
  if (!Array.isArray(data?.data)) throw new Error('Meta API error: unexpected response')
  // `name` is a prefix filter on Meta's side, so match exactly.
  const t = (data.data as Array<Record<string, unknown>>).find(
    (row) => row?.name === name && row?.language === 'pt_BR',
  )
  if (!t) return null
  if (typeof t.status !== 'string') throw new Error('Meta API error: unexpected response')
  return {
    id: typeof t.id === 'string' ? t.id : '',
    name,
    status: t.status,
    category: typeof t.category === 'string' ? t.category : '',
    rejectedReason: typeof t.rejected_reason === 'string' ? t.rejected_reason : null,
  }
}
