// ONE-OFF, removed with the route. Kept here (not in platform-whatsapp.ts) so
// this temporary code does not collide with the permanent lookup helper.
import { GRAPH_API_BASE, getPlatformCredentials } from '@/lib/platform-whatsapp'

export interface MetaTemplate {
  id: string
  name: string
  status: string
  category: string
  rejectedReason: string | null
}

async function metaError(res: Response) {
  const data = await res.json().catch(() => null)
  const err = data?.error
  const details = [err?.message, err?.code && `code=${err.code}`].filter(Boolean).join(' | ')
  return new Error(`Meta API error: ${details || `HTTP ${res.status}`}`)
}

export async function findTemplate(name: string): Promise<MetaTemplate | null> {
  const creds = getPlatformCredentials()
  const params = new URLSearchParams({ name, fields: 'id,name,status,category,language,rejected_reason' })
  const res = await fetch(`${GRAPH_API_BASE}/${creds.businessAccountId}/message_templates?${params}`, {
    headers: { Authorization: `Bearer ${creds.accessToken}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw await metaError(res)
  const data = await res.json()
  // `name` is a prefix filter on Meta's side, so match exactly.
  const t = (data?.data as Array<Record<string, string>> | undefined)?.find(
    (row) => row.name === name && row.language === 'pt_BR',
  )
  return t
    ? { id: t.id, name: t.name, status: t.status, category: t.category, rejectedReason: t.rejected_reason ?? null }
    : null
}

export async function deleteTemplate(name: string): Promise<void> {
  const creds = getPlatformCredentials()
  const params = new URLSearchParams({ name })
  const res = await fetch(`${GRAPH_API_BASE}/${creds.businessAccountId}/message_templates?${params}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${creds.accessToken}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw await metaError(res)
}
