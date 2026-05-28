import { getTenant } from '@/db/queries/tenants'

const GRAPH_API_VERSION = 'v21.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

interface InstagramCredentials {
  pageId: string
  igBusinessAccountId: string
  pageAccessToken: string
}

export async function getCredentials(tenantId: string): Promise<InstagramCredentials> {
  const tenant = await getTenant(tenantId)
  if (!tenant) throw new Error('Tenant not found')
  const settings = tenant.settings as Record<string, unknown> | null
  const pageId = settings?.instagram_page_id as string | undefined | null
  const igBusinessAccountId = settings?.instagram_business_account_id as
    | string
    | undefined
    | null
  const pageAccessToken = settings?.instagram_page_access_token as
    | string
    | undefined
    | null
  if (!pageId || !igBusinessAccountId || !pageAccessToken) {
    throw new Error('Instagram credentials missing')
  }
  return { pageId, igBusinessAccountId, pageAccessToken }
}

async function postMessage(
  pageAccessToken: string,
  body: Record<string, unknown>,
): Promise<{ message_id: string }> {
  const res = await fetch(
    `${GRAPH_API_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const data = await res.json()
  if (!res.ok) {
    const errorMsg = data?.error?.message ?? 'Unknown Meta API error'
    throw new Error(`Meta API error: ${errorMsg}`)
  }
  return data as { message_id: string }
}

export async function sendTextMessage(
  tenantId: string,
  igsid: string,
  body: string,
  opts: { tag?: 'HUMAN_AGENT' } = {},
): Promise<{ metaMessageId: string }> {
  const creds = await getCredentials(tenantId)
  const payload: Record<string, unknown> = {
    recipient: { id: igsid },
    message: { text: body },
    ...(opts.tag && { messaging_type: 'MESSAGE_TAG', tag: opts.tag }),
  }
  const data = await postMessage(creds.pageAccessToken, payload)
  return { metaMessageId: data.message_id }
}

export async function sendMediaMessage(
  tenantId: string,
  igsid: string,
  mediaType: 'image' | 'video' | 'audio' | 'file',
  mediaUrl: string,
  opts: { tag?: 'HUMAN_AGENT' } = {},
): Promise<{ metaMessageId: string }> {
  const creds = await getCredentials(tenantId)
  const payload: Record<string, unknown> = {
    recipient: { id: igsid },
    message: {
      attachment: {
        type: mediaType,
        payload: { url: mediaUrl, is_reusable: false },
      },
    },
    ...(opts.tag && { messaging_type: 'MESSAGE_TAG', tag: opts.tag }),
  }
  const data = await postMessage(creds.pageAccessToken, payload)
  return { metaMessageId: data.message_id }
}

export async function getUserProfile(
  tenantId: string,
  igsid: string,
): Promise<{ name?: string; username?: string; profile_pic?: string }> {
  const creds = await getCredentials(tenantId)
  const url = `${GRAPH_API_BASE}/${encodeURIComponent(igsid)}?fields=name,username,profile_pic&access_token=${encodeURIComponent(creds.pageAccessToken)}`
  const res = await fetch(url)
  if (res.status === 400) {
    // Private profile, deleted user, or otherwise un-fetchable. Treat as absent.
    return {}
  }
  const data = await res.json()
  if (!res.ok) {
    const errorMsg = data?.error?.message ?? 'Unknown Meta API error'
    throw new Error(`Meta API error: ${errorMsg}`)
  }
  return data as { name?: string; username?: string; profile_pic?: string }
}

// Allowed Meta CDN hostnames (suffix match). Anything else is rejected to
// prevent SSRF: the webhook payload is signed, but the URL inside it is
// otherwise arbitrary.
const ALLOWED_MEDIA_HOST_SUFFIXES = [
  'cdninstagram.com',
  'fbcdn.net',
  'lookaside.fbsbx.com',
]

// 50 MB cap. Larger media is rejected before consuming the body.
const MAX_MEDIA_BYTES = 50 * 1024 * 1024

// IPv4 literal (e.g. "127.0.0.1") or any IPv6-style literal — reject outright.
const IP_LITERAL_RE = /^(?:\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]*:[0-9a-f:]*\]?$/i
// Private CIDR / loopback / link-local / unique-local prefixes.
const PRIVATE_CIDR_RE =
  /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/

export function assertAllowedMediaUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Media URL is not a valid URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Media URL must be https')
  }
  const host = parsed.hostname.toLowerCase()
  if (IP_LITERAL_RE.test(host) || PRIVATE_CIDR_RE.test(host)) {
    throw new Error('Media URL host is not allowed')
  }
  const ok = ALLOWED_MEDIA_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  )
  if (!ok) {
    throw new Error(`Media URL host ${host} is not on the Meta CDN allowlist`)
  }
  return parsed
}

export async function downloadAndStoreMedia(
  tenantId: string,
  attachmentUrl: string,
  filename: string,
): Promise<string> {
  // Instagram webhooks deliver the CDN URL directly in the attachment payload,
  // so we skip the mediaId-to-URL resolution step that the WhatsApp helper performs.
  // The CDN URL expires in ~24h, so we must download and store immediately.
  assertAllowedMediaUrl(attachmentUrl)
  const res = await fetch(attachmentUrl)
  if (!res.ok) throw new Error('Failed to download media')

  // Enforce a size cap from Content-Length before consuming the body.
  const contentLengthHeader = res.headers.get('content-length')
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader)
    if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) {
      throw new Error(
        `Media exceeds size cap: ${declared} > ${MAX_MEDIA_BYTES}`,
      )
    }
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    throw new Error(
      `Media exceeds size cap: ${buffer.byteLength} > ${MAX_MEDIA_BYTES}`,
    )
  }
  const mimeType = res.headers.get('content-type') ?? 'application/octet-stream'

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const path = `instagram/${tenantId}/${filename}`
  const { error } = await supabase.storage
    .from('media')
    .upload(path, buffer, { contentType: mimeType, upsert: true })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  const { data: urlData } = supabase.storage.from('media').getPublicUrl(path)
  return urlData.publicUrl
}

export async function verifyCredentials(
  pageId: string,
  pageAccessToken: string,
): Promise<{ ok: boolean; igBusinessAccountId?: string; error?: string }> {
  try {
    const url = `${GRAPH_API_BASE}/${encodeURIComponent(pageId)}?fields=instagram_business_account&access_token=${encodeURIComponent(pageAccessToken)}`
    const res = await fetch(url)
    const data = await res.json()
    if (!res.ok) {
      const errorMsg = data?.error?.message ?? 'Unknown Meta API error'
      return { ok: false, error: errorMsg }
    }
    const igBusinessAccountId = data?.instagram_business_account?.id as
      | string
      | undefined
    if (!igBusinessAccountId) {
      return {
        ok: false,
        error: 'Page is not linked to an Instagram Business account',
      }
    }
    return { ok: true, igBusinessAccountId }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    return { ok: false, error: message }
  }
}
