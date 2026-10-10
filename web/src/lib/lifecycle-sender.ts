import { after } from 'next/server'
import {
  claimLifecycleSend,
  finishLifecycleSend,
  findLifecycleRecipients,
  isTenantLifecycleOptedOut,
  recordSkippedLifecycleSend,
  type LifecycleChannel,
  type LifecycleRecipient,
} from '@/db/queries/lifecycle'
import { getActivationState } from '@/lib/activation'
import { getAppUrl } from '@/lib/app-url'
import { sendLifecycleEmail } from '@/lib/email'
import { lifecycleOptOutUrl } from '@/lib/lifecycle-opt-out'
import {
  LIFECYCLE_WELCOME,
  ownerFirstName,
  renderLifecycleBody,
  type LifecycleMessage,
} from '@/lib/lifecycle-messages'
import { reportSideEffectFailure } from '@/lib/observability'
import { isCanonicalBrPhone, normalizeBrPhone } from '@/lib/phone'
import { sendPlatformTemplate } from '@/lib/platform-whatsapp'

export type ChannelOutcome = 'sent' | 'failed' | 'skipped' | 'already_claimed'
export interface DeliveryOutcome {
  whatsapp: ChannelOutcome
  email: ChannelOutcome
}

export function isLifecycleEnabled(): boolean {
  return process.env.LIFECYCLE_ENABLED === 'true'
}

async function deliverChannel(
  recipient: LifecycleRecipient,
  message: LifecycleMessage,
  channel: LifecycleChannel,
  to: string,
  send: () => Promise<{ metaMessageId?: string }>,
): Promise<ChannelOutcome> {
  const key = { tenantId: recipient.tenantId, messageKey: message.key, channel }
  const id = await claimLifecycleSend({ ...key, recipient: to })
  if (!id) return 'already_claimed'
  try {
    const { metaMessageId } = await send()
    await finishLifecycleSend(id, { status: 'sent', metaMessageId })
    return 'sent'
  } catch (err) {
    const extra = { tenantId: recipient.tenantId, key: message.key }
    reportSideEffectFailure(err, { area: 'lifecycle', step: channel, extra })
    try {
      await finishLifecycleSend(id, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    } catch (finishErr) {
      reportSideEffectFailure(finishErr, { area: 'lifecycle', step: `${channel}_finish`, extra })
    }
    return 'failed'
  }
}

export async function deliverLifecycleMessage(
  recipient: LifecycleRecipient,
  message: LifecycleMessage,
): Promise<DeliveryOutcome> {
  if (message.category === 'MARKETING' && (await isTenantLifecycleOptedOut(recipient.tenantId))) {
    return { whatsapp: 'skipped', email: 'skipped' }
  }
  const firstName = ownerFirstName(recipient.ownerName)
  const body = renderLifecycleBody(message, firstName)

  const phone = recipient.tenantPhone ? normalizeBrPhone(recipient.tenantPhone) : ''
  let whatsapp: ChannelOutcome
  if (!isCanonicalBrPhone(phone)) {
    await recordSkippedLifecycleSend({
      tenantId: recipient.tenantId,
      messageKey: message.key,
      channel: 'whatsapp',
      recipient: phone || 'none',
      reason: 'invalid_phone',
    })
    whatsapp = 'skipped'
  } else {
    whatsapp = await deliverChannel(recipient, message, 'whatsapp', phone, () =>
      sendPlatformTemplate(phone, message.templateName, [firstName]),
    )
  }

  const email = await deliverChannel(recipient, message, 'email', recipient.ownerEmail, async () => {
    await sendLifecycleEmail({
      to: recipient.ownerEmail,
      subject: message.emailSubject,
      body,
      button: message.button
        ? { label: message.button.label, url: getAppUrl() + message.button.path }
        : null,
      optOutUrl: message.category === 'MARKETING' ? lifecycleOptOutUrl(recipient.tenantId) : null,
    })
    return {}
  })

  return { whatsapp, email }
}

export function scheduleLifecycleWelcome(target: { tenantId: string } | { ownerEmail: string }): void {
  after(async () => {
    try {
      if (!isLifecycleEnabled()) return
      const recipients = await findLifecycleRecipients(target)
      if (recipients.length !== 1) return
      const [recipient] = recipients
      const state = await getActivationState(recipient.tenantId)
      if (!state || !LIFECYCLE_WELCOME.isDue(state)) return
      await deliverLifecycleMessage(recipient, LIFECYCLE_WELCOME)
    } catch (err) {
      reportSideEffectFailure(err, { area: 'lifecycle', step: 'welcome' })
    }
  })
}
