import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/queries/referrals', () => ({ getOwnerContact: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendLifecycleEmail: vi.fn() }))

import { referralRewardEmailContent, sendReferralRewardEmail, type RewardEmailInput } from '../emails'

const APP = 'https://app.test'
const input = (over: Partial<RewardEmailInput>): RewardEmailInput => ({
  referrerTenantId: 't1',
  previous: { discountPercent: 20, bonusCredits: 0 },
  current: { discountPercent: 40, bonusCredits: 0, counting: 2 },
  referral: { referredName: 'Clínica Flor', nowCounting: true },
  ...over,
})

describe('referralRewardEmailContent', () => {
  it('announces a referral that started counting and raised the percent', () => {
    const mail = referralRewardEmailContent(input({}), APP)!
    expect(mail.subject).toBe('Indique e Ganhe: sua indicação começou a contar')
    expect(mail.content.paragraphs).toEqual([
      'Sua indicação Clínica Flor começou a contar: seu desconto agora é de 40% a partir da próxima fatura.',
    ])
    expect(mail.content.button).toEqual({ label: 'Ver minhas indicações', url: `${APP}/configuracoes?tab=indique` })
  })

  it('announces a referral that stopped counting', () => {
    const mail = referralRewardEmailContent(
      input({
        current: { discountPercent: 20, bonusCredits: 0, counting: 1 },
        previous: { discountPercent: 40, bonusCredits: 0 },
        referral: { referredName: 'Clínica Flor', nowCounting: false },
      }),
      APP,
    )!
    expect(mail.subject).toBe('Indique e Ganhe: seu desconto mudou')
    expect(mail.content.paragraphs[0]).toBe(
      'Sua indicação Clínica Flor deixou de contar: seu desconto agora é de 20% a partir da próxima fatura.',
    )
  })

  it('uses the no-discount copy when the percent falls to 0', () => {
    const mail = referralRewardEmailContent(
      input({
        current: { discountPercent: 0, bonusCredits: 0, counting: 0 },
        referral: { referredName: 'Clínica Flor', nowCounting: false },
      }),
      APP,
    )!
    expect(mail.content.paragraphs[0]).toBe(
      'Sua indicação Clínica Flor deixou de contar: a partir da próxima fatura, sua assinatura não tem mais desconto de indicação.',
    )
  })

  it('announces a bonus-only rise', () => {
    const mail = referralRewardEmailContent(
      input({
        previous: { discountPercent: 100, bonusCredits: 0 },
        current: { discountPercent: 100, bonusCredits: 100, counting: 6 },
      }),
      APP,
    )!
    expect(mail.subject).toBe('Indique e Ganhe: sua indicação começou a contar')
    expect(mail.content.paragraphs[0]).toBe(
      'Sua indicação Clínica Flor começou a contar: você ganha +100 créditos de WhatsApp por mês.',
    )
  })

  it('uses the generic copy without a referral context', () => {
    const mail = referralRewardEmailContent(input({ referral: null }), APP)!
    expect(mail.subject).toBe('Indique e Ganhe: seu desconto mudou')
    expect(mail.content.paragraphs[0]).toBe('Seu desconto de indicação agora é de 40% a partir da próxima fatura.')
  })

  it('treats a missing previous row as 0% / 0 credits', () => {
    const mail = referralRewardEmailContent(
      input({ previous: null, current: { discountPercent: 20, bonusCredits: 0, counting: 1 } }),
      APP,
    )!
    expect(mail.content.paragraphs[0]).toContain('desconto agora é de 20%')
  })

  it('returns null when nothing user-visible changed', () => {
    expect(
      referralRewardEmailContent(input({ current: { discountPercent: 20, bonusCredits: 0, counting: 1 } }), APP),
    ).toBeNull()
    expect(
      referralRewardEmailContent(
        input({ previous: null, current: { discountPercent: 0, bonusCredits: 0, counting: 0 }, referral: null }),
        APP,
      ),
    ).toBeNull()
  })
})

describe('sendReferralRewardEmail', () => {
  it('sends to the owner', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'e1' })
    const owner = vi.fn().mockResolvedValue({ email: 'o@x.com', ownerName: 'Ana', clinicName: 'C' })
    await sendReferralRewardEmail(input({}), { owner, send, appUrl: () => APP })
    expect(owner).toHaveBeenCalledWith('t1')
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'o@x.com', subject: 'Indique e Ganhe: sua indicação começou a contar' }),
    )
  })

  it('skips silently without an owner contact', async () => {
    const send = vi.fn()
    await sendReferralRewardEmail(input({}), { owner: vi.fn().mockResolvedValue(null), send, appUrl: () => APP })
    expect(send).not.toHaveBeenCalled()
  })

  it('does not send when nothing changed', async () => {
    const send = vi.fn()
    const owner = vi.fn().mockResolvedValue({ email: 'o@x.com', ownerName: 'Ana', clinicName: 'C' })
    await sendReferralRewardEmail(input({ current: { discountPercent: 20, bonusCredits: 0, counting: 1 } }), {
      owner,
      send,
      appUrl: () => APP,
    })
    expect(send).not.toHaveBeenCalled()
  })
})
