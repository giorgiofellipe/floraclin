import { getOwnerContact } from '@/db/queries/referrals'
import { getAppUrl } from '@/lib/app-url'
import { sendLifecycleEmail } from '@/lib/email'
import type { EmailContent } from '@/lib/email-layout'

export interface RewardEmailInput {
  referrerTenantId: string
  previous: { discountPercent: number; bonusCredits: number } | null
  current: { discountPercent: number; bonusCredits: number; counting: number }
  referral: { referredName: string; nowCounting: boolean } | null // null for reconcile/admin/subscription triggers
}

const SUBJECT_COUNTING = 'Indique e Ganhe: sua indicação começou a contar'
const SUBJECT_CHANGED = 'Indique e Ganhe: seu desconto mudou'

function build(subject: string, paragraph: string, appUrl: string): { subject: string; content: EmailContent } {
  return {
    subject,
    content: {
      preheader: paragraph,
      heading: subject.replace('Indique e Ganhe: ', ''),
      paragraphs: [paragraph],
      button: { label: 'Ver minhas indicações', url: `${appUrl}/configuracoes?tab=indique&from=status_email` },
    },
  }
}

/** Pure. Null when nothing user-visible changed. */
export function referralRewardEmailContent(
  input: RewardEmailInput,
  appUrl: string,
): { subject: string; content: EmailContent } | null {
  const before = input.previous ?? { discountPercent: 0, bonusCredits: 0 }
  const { discountPercent: percent, bonusCredits: bonus } = input.current
  const percentChanged = percent !== before.discountPercent
  const { referral } = input

  if (referral?.nowCounting) {
    if (percent > before.discountPercent) {
      return build(
        SUBJECT_COUNTING,
        `Sua indicação ${referral.referredName} começou a contar: seu desconto agora é de ${percent}% a partir da próxima fatura.`,
        appUrl,
      )
    }
    if (bonus > before.bonusCredits) {
      return build(
        SUBJECT_COUNTING,
        `Sua indicação ${referral.referredName} começou a contar: você ganha +${bonus} créditos de WhatsApp por mês.`,
        appUrl,
      )
    }
  } else if (referral && percentChanged) {
    const paragraph =
      percent === 0
        ? `Sua indicação ${referral.referredName} deixou de contar: a partir da próxima fatura, sua assinatura não tem mais desconto de indicação.`
        : `Sua indicação ${referral.referredName} deixou de contar: seu desconto agora é de ${percent}% a partir da próxima fatura.`
    return build(SUBJECT_CHANGED, paragraph, appUrl)
  }

  if (percentChanged) {
    return build(
      SUBJECT_CHANGED,
      `Seu desconto de indicação agora é de ${percent}% a partir da próxima fatura.`,
      appUrl,
    )
  }
  return null
}

export async function sendReferralRewardEmail(
  input: RewardEmailInput,
  deps: { owner: typeof getOwnerContact; send: typeof sendLifecycleEmail; appUrl: () => string } = {
    owner: getOwnerContact,
    send: sendLifecycleEmail,
    appUrl: getAppUrl,
  },
): Promise<void> {
  const owner = await deps.owner(input.referrerTenantId)
  if (!owner) return
  const message = referralRewardEmailContent(input, deps.appUrl())
  if (!message) return
  await deps.send({ to: owner.email, subject: message.subject, content: message.content })
}
