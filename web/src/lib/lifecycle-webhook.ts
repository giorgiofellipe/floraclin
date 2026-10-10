import {
  findLifecycleSendByMetaId,
  findRecentLifecycleTenantsByPhone,
  hasRecentConversationForPhone,
  insertLifecycleReply,
  markLifecycleSendFailedByMetaId,
} from '@/db/queries/lifecycle'
import { notifyDiscord } from '@/lib/discord'
import { optOutTenantLifecycle } from '@/lib/lifecycle-opt-out'
import { reportSideEffectFailure } from '@/lib/observability'
import { normalizeBrPhone } from '@/lib/phone'

export interface InboundForCapture {
  id: string
  from: string
  type: string
  text?: { body: string }
  button?: { text?: string }
  context?: { id?: string }
}

const OPT_OUT_WORDS = new Set(['parar', 'sair', 'stop', 'cancelar'])
const CAPTURE_WINDOW_MS = 30 * 86_400_000

function isOptOut(body: string): boolean {
  const word = body
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return OPT_OUT_WORDS.has(word)
}

function replyBody(msg: InboundForCapture): string {
  if (msg.type === 'text') return msg.text?.body ?? ''
  if (msg.type === 'button') return msg.button?.text ?? ''
  return '[mídia]'
}

export async function captureLifecycleReply(msg: InboundForCapture): Promise<boolean> {
  const phone = normalizeBrPhone(msg.from)
  let match: { tenantId: string; tenantName: string; messageKey: string } | null = null

  if (msg.context?.id) {
    const send = await findLifecycleSendByMetaId(msg.context.id)
    if (send) {
      if (send.recipient !== phone) {
        reportSideEffectFailure(new Error('lifecycle reply phone mismatch'), {
          area: 'lifecycle',
          step: 'reply_mismatch',
          extra: { tenantId: send.tenantId },
        })
        return false
      }
      match = send
    }
  }

  if (!match) {
    const since = new Date(Date.now() - CAPTURE_WINDOW_MS)
    const candidates = await findRecentLifecycleTenantsByPhone(phone, since)
    if (candidates.length !== 1) {
      if (candidates.length > 1) {
        reportSideEffectFailure(new Error('lifecycle reply ambiguous'), {
          area: 'lifecycle',
          step: 'reply_ambiguous',
          extra: { tenantIds: candidates.map((c) => c.tenantId) },
        })
      }
      return false
    }
    // An owner who is also a clinic contact must keep reaching that clinic,
    // except for the exact opt-out keyword.
    if (!isOptOut(replyBody(msg)) && (await hasRecentConversationForPhone(phone, since))) {
      return false
    }
    match = candidates[0]
  }

  const body = replyBody(msg)
  if (isOptOut(body)) await optOutTenantLifecycle(match.tenantId)
  const inserted = await insertLifecycleReply({
    tenantId: match.tenantId,
    messageKey: match.messageKey,
    body,
    metaMessageId: msg.id,
  })
  if (inserted) {
    await notifyDiscord({
      kind: 'lifecycle.reply',
      tenantName: match.tenantName,
      tenantId: match.tenantId,
      messageKey: match.messageKey,
      body,
    })
  }
  return true
}

export async function handleLifecycleStatus(status: {
  id: string
  status: string
  errors?: { title?: string; message?: string }[]
}): Promise<boolean> {
  if (status.status === 'failed') {
    const first = status.errors?.[0]
    const text = first?.message || first?.title || 'failed'
    return markLifecycleSendFailedByMetaId(status.id, text)
  }
  return (await findLifecycleSendByMetaId(status.id)) !== null
}
