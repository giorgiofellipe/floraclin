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
import { sendLifecycleEmail } from '@/lib/email'
import { lifecycleClickUrl } from '@/lib/lifecycle-attribution'
import { lifecycleOptOutUrl } from '@/lib/lifecycle-opt-out'
import {
  LIFECYCLE_WELCOME,
  ownerFirstName,
  renderLifecycleEmail,
  type LifecycleMessage,
  type LifecycleRenderContext,
} from '@/lib/lifecycle-messages'
import { getSubscription, listPlans } from '@/db/queries/subscriptions'
import { getTrialRecap } from '@/db/queries/trial-recap'
import { publicWinbackOffer } from '@/lib/winback'
import { getValidatedWinbackOffer } from '@/lib/winback-offer'
import { sellablePlans } from '@/lib/plan-benefits'
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
  send: (sendId: string) => Promise<{ metaMessageId?: string; providerMessageId?: string }>,
): Promise<ChannelOutcome> {
  const key = { tenantId: recipient.tenantId, messageKey: message.key, channel }
  const id = await claimLifecycleSend({ ...key, recipient: to })
  if (!id) return 'already_claimed'
  try {
    const { metaMessageId, providerMessageId } = await send(id)
    await finishLifecycleSend(id, { status: 'sent', metaMessageId, providerMessageId })
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

  const phone = recipient.tenantPhone ? normalizeBrPhone(recipient.tenantPhone) : ''
  let whatsapp: ChannelOutcome
  if (message.whatsapp === false) {
    // Template not approved on Meta yet: email only. Recording the skip is
    // what lets the key complete (both channels must have a row).
    await recordSkippedLifecycleSend({
      tenantId: recipient.tenantId,
      messageKey: message.key,
      channel: 'whatsapp',
      recipient: phone || 'none',
      reason: 'template_not_approved',
    })
    whatsapp = 'skipped'
  } else if (!isCanonicalBrPhone(phone)) {
    await recordSkippedLifecycleSend({
      tenantId: recipient.tenantId,
      messageKey: message.key,
      channel: 'whatsapp',
      recipient: phone || 'none',
      reason: 'invalid_phone',
    })
    whatsapp = 'skipped'
  } else {
    whatsapp = await deliverChannel(recipient, message, 'whatsapp', phone, (sendId) =>
      sendPlatformTemplate(phone, message.templateName, [firstName], {
        buttonUrlParams: message.button ? [sendId] : [],
      }),
    )
  }

  const email = await deliverChannel(recipient, message, 'email', recipient.ownerEmail, async (sendId) => {
    const ctx = message.render ? await loadRenderContext(recipient.tenantId, !!message.usesOffer) : undefined
    const rendered = renderLifecycleEmail(message, firstName, ctx)
    const sent = await sendLifecycleEmail({
      to: recipient.ownerEmail,
      subject: rendered.subject,
      replyTo: message.replyTo?.(),
      content: {
        ...rendered.content,
        button: message.button
          ? {
              label: message.button.label,
              url: lifecycleClickUrl(sendId),
            }
          : null,
        optOutUrl: message.category === 'MARKETING' ? lifecycleOptOutUrl(recipient.tenantId) : null,
      },
    })
    return { providerMessageId: sent.id }
  })

  return { whatsapp, email }
}

async function paidPlans() {
  return sellablePlans(await listPlans(true))
}

/**
 * Live data for messages with a `render`: the trial end, what the clinic
 * built, and a win-back offer only if Stripe confirms the code right now.
 * Loaded inside the claimed send, so a failure here fails that send (and is
 * recorded) rather than sending a half-filled email.
 */

async function loadRenderContext(
  tenantId: string,
  withOffer: boolean,
  now: Date = new Date(),
): Promise<LifecycleRenderContext> {
  const [subscription, recap] = await Promise.all([getSubscription(tenantId), getTrialRecap(tenantId)])
  if (!subscription) throw new Error('subscription not found for lifecycle render')
  const offer = withOffer ? publicWinbackOffer(await getValidatedWinbackOffer(subscription, await paidPlans(), now)) : null
  return { now, endsAt: subscription.currentPeriodEnd, recap, offer }
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
