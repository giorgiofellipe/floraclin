import { upsertConversation, createMessage, pushSseEvent } from '@/db/queries/whatsapp'
import { sendTemplateMessage, resolveTemplateBody, type TemplateButtonParam } from '@/lib/whatsapp'
import { reportSideEffectFailure } from '@/lib/observability'
import type { CreditContext } from '@/lib/whatsapp-credit-ledger'

interface AutomatedSendTemplate {
  name: string
  language: string
  components: unknown
}

/**
 * Sends a template to a patient and records it in the clinic's inbox. The
 * inbox write is best effort: once Meta accepted the message, a failure there
 * must not count the send as failed or make the caller send it again.
 */
export async function sendAndRecordTemplate({
  tenantId,
  phone,
  recipient,
  template,
  params,
  buttonParams,
  actor = { type: 'system' },
}: {
  tenantId: string
  phone: string
  recipient: { patientId: string | null; name: string | null }
  template: AutomatedSendTemplate
  params: Record<string, string>
  buttonParams?: TemplateButtonParam[]
  actor?: CreditContext['actor']
}) {
  const result = await sendTemplateMessage(
    tenantId,
    { actor, recipient },
    phone,
    template.name,
    template.language,
    params,
    buttonParams,
  )

  try {
    const conversation = await upsertConversation(
      tenantId,
      phone,
      recipient.name ?? '',
      undefined,
      recipient.patientId ?? undefined,
    )
    const message = await createMessage(tenantId, conversation.id, {
      direction: 'outbound',
      metaMessageId: result.metaMessageId,
      body: resolveTemplateBody(template.components, params),
      templateName: template.name,
      deliveryStatus: 'sent',
    })
    await pushSseEvent(tenantId, 'new_message', { conversationId: conversation.id, message })
  } catch (err) {
    reportSideEffectFailure(err, {
      area: 'whatsapp',
      step: 'automation_inbox_record',
      extra: { tenantId, metaMessageId: result.metaMessageId },
    })
  }

  return result
}
