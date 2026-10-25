import { after } from 'next/server'
import {
  claimLifecycleSend,
  finishLifecycleSend,
  findLifecycleRecipients,
  isFirstTemplateNotApprovedSkipToday,
  isTenantLifecycleOptedOut,
  recordSkippedLifecycleSend,
  type LifecycleChannel,
  type LifecycleRecipient,
} from '@/db/queries/lifecycle'
import { getActivationState } from '@/lib/activation'
import { brToday, formatBrDayMonth } from '@/lib/dates'
import { notifyDiscord } from '@/lib/discord'
import { sendLifecycleEmail } from '@/lib/email'
import { lifecycleClickUrl } from '@/lib/lifecycle-attribution'
import { lifecycleOptOutUrl } from '@/lib/lifecycle-opt-out'
import {
  LIFECYCLE_WELCOME,
  offerToShow,
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
import {
  getLifecycleTemplateApproval,
  isTemplateAlertSettled,
  markTemplateAlertSettled,
} from '@/lib/lifecycle-template-status'

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
    const approval = await getLifecycleTemplateApproval(message.templateName)
    if (approval.state === 'not_approved') {
      // Email only. The skip row completes the key for this clinic, so it is
      // never resent by WhatsApp once the template is approved later.
      const skipId = await recordSkippedLifecycleSend({
        tenantId: recipient.tenantId,
        messageKey: message.key,
        channel: 'whatsapp',
        recipient: phone,
        reason: 'template_not_approved',
      })
      if (skipId) await alertTemplateNotApproved(message, approval.status, skipId)
      whatsapp = 'skipped'
    } else {
      // Fail open: a lookup error records no template_not_approved skip; the
      // send is attempted. If Meta rejects it (e.g. the template is not
      // approved), a `failed` row is recorded, which like any failed send
      // also completes the key: it is not retried. A missing FLORACLIN_WA_*
      // env (previews) is not reported here: the send path reports it.
      if (approval.state === 'unknown' && approval.code !== 'WHATSAPP_NOT_CONFIGURED') {
        console.error('[lifecycle] template status lookup failed', message.templateName, approval.error)
        reportSideEffectFailure(new Error(approval.error), {
          area: 'lifecycle',
          step: 'template_status',
          extra: { tenantId: recipient.tenantId, key: message.key, templateName: message.templateName },
        })
      }
      whatsapp = await deliverChannel(recipient, message, 'whatsapp', phone, async (sendId) => {
        const offer = await whatsappOffer(recipient, message)
        return sendPlatformTemplate(
          phone,
          offer ? offer.templateName : message.templateName,
          offer ? [firstName, offer.label, formatBrDayMonth(offer.endsAt)] : [firstName],
          { buttonUrlParams: message.button ? [sendId] : [] },
        )
      })
    }
  }

  const email = await deliverChannel(recipient, message, 'email', recipient.ownerEmail, async (sendId) => {
    const ctx = message.render ? await loadRenderContext(recipient.tenantId, !!message.offerTemplate) : undefined
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

/**
 * Discord alert (#floraclin-logs) for a skip because of the template, at most
 * once per message key per BR day: only the instance whose skip row is the
 * first of the day for the key posts. Never throws, so the email still goes.
 */
async function alertTemplateNotApproved(message: LifecycleMessage, status: string, skipId: string) {
  const today = brToday()
  if (isTemplateAlertSettled(message.key, today)) return
  try {
    const first = await isFirstTemplateNotApprovedSkipToday(message.key, skipId)
    markTemplateAlertSettled(message.key, today)
    if (!first) return
    await notifyDiscord({
      kind: 'lifecycle.template_not_approved',
      templateName: message.templateName,
      messageKey: message.key,
      status,
    })
  } catch (err) {
    reportSideEffectFailure(err, { area: 'lifecycle', step: 'template_alert', extra: { key: message.key } })
  }
}

/** Null sends the plain template: no offer in the email, the offer template not
 *  approved yet, or a failed load. The offer never costs the clinic the WhatsApp. */
async function whatsappOffer(recipient: LifecycleRecipient, message: LifecycleMessage) {
  if (!message.offerTemplate) return null
  try {
    const approval = await getLifecycleTemplateApproval(message.offerTemplate.name)
    if (approval.state !== 'approved') return null
    const offer = offerToShow(await loadRenderContext(recipient.tenantId, true))
    return offer ? { templateName: message.offerTemplate.name, ...offer } : null
  } catch (err) {
    reportSideEffectFailure(err, { area: 'lifecycle', step: 'whatsapp_offer', extra: { tenantId: recipient.tenantId, key: message.key } })
    return null
  }
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
