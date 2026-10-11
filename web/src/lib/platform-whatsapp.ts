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
): Promise<{ metaMessageId: string }> {
  const creds = getPlatformCredentials()
  const data = await platformFetch(`/${creds.phoneNumberId}/messages`, creds.accessToken, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'pt_BR' },
      ...(bodyParams.length > 0 && {
        components: [
          {
            type: 'body',
            parameters: bodyParams.map((text) => ({ type: 'text', text })),
          },
        ],
      }),
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
