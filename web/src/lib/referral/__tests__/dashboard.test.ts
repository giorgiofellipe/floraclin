import { describe, expect, it } from 'vitest'
import { parseBrDate } from '@/lib/dates'
import { buildReferralDashboard, referralShareText, type DashboardInput } from '../dashboard'

const base: DashboardInput = {
  canRefer: true,
  enrollmentOpen: true,
  code: 'MECA7K',
  rewardsActive: true,
  counting: 0,
  planPriceCents: 9900,
  planEligible: true,
  nextInvoiceAt: parseBrDate('2026-11-10', '12:00:00'),
  referrals: [],
  events: [],
}
const build = (over: Partial<DashboardInput> = {}) => buildReferralDashboard({ ...base, ...over })

describe('buildReferralDashboard progress copy', () => {
  it.each([
    [0, '0 de 5 clínicas pagantes, faltam 5 para FloraClin grátis', null, 0],
    [3, '3 de 5 clínicas pagantes, faltam 2 para FloraClin grátis', null, 60],
    [4, '4 de 5 clínicas pagantes, falta 1 para FloraClin grátis', null, 80],
    [5, '5 de 5: seu FloraClin está grátis 🎉', null, 100],
    [7, '5 de 5: seu FloraClin está grátis 🎉', '+200 créditos de WhatsApp por mês com 7 clínicas pagantes', 100],
  ])('counting %i', (counting, label, bonusLabel, percent) => {
    expect(build({ counting }).progress).toEqual({ counting, target: 5, percent, label, bonusLabel })
  })
})

describe('discount line', () => {
  it('shows amount saved out of the full price and the next invoice day', () => {
    expect(build({ counting: 3 }).discountLine).toBe(
      'Seu desconto atual: 60% (R$ 59,40 de R$ 99,00) a partir da próxima fatura, em 10/11.',
    )
  })

  const explainer =
    'Cada clínica indicada que está pagando vale 20% de desconto na sua assinatura. Com 5, o FloraClin sai de graça.'

  it('explains the program at 0%', () => {
    expect(build({ counting: 0 }).discountLine).toBe(explainer)
  })

  it('is 0% when rewards are inactive', () => {
    expect(build({ counting: 3, rewardsActive: false }).discountLine).toBe(explainer)
  })

  it('is 0% for a yearly (ineligible) plan', () => {
    expect(build({ counting: 3, planEligible: false }).discountLine).toBe(explainer)
  })
})

describe('canRefer=false', () => {
  it('after enrollment closes, keeps the running discount but hides the link and code', () => {
    const view = build({ enrollmentOpen: false, counting: 3, previousCodes: ['OLD1'] })
    expect(view).toMatchObject({ link: null, code: null, previousCodes: [], whatsappShareUrl: null })
    expect(view.inactiveMessage).toBe(
      'O programa não aceita mais novas indicações. As indicações que você já fez continuam valendo até o encerramento.',
    )
    expect(view.discountLine).toContain('Seu desconto atual: 60%')
  })

  it('has no link, shows the inactive message and still lists referrals', () => {
    const view = build({
      canRefer: false,
      code: null,
      counting: 2,
      referrals: [
        {
          id: 'r1',
          referredName: 'Clínica A',
          capturedAt: parseBrDate('2026-10-02', '12:00:00'),
          status: 'trial',
          pausedReason: null,
          ineligibleReason: null,
        },
      ],
    })
    expect(view.link).toBeNull()
    expect(view.shareText).toBeNull()
    expect(view.whatsappShareUrl).toBeNull()
    expect(view.inactiveMessage).toBe('Seu link de indicação fica ativo quando sua clínica tem uma assinatura paga.')
    expect(view.referrals).toEqual([
      { id: 'r1', name: 'Clínica A', signupDate: '02/10/2026', label: 'em teste', sublabel: null },
    ])
  })
})

describe('canRefer=false discount line', () => {
  const event = (discountPercent: number) => ({
    createdAt: parseBrDate('2026-10-15', '12:00:00'),
    counting: discountPercent / 20,
    discountPercent,
    bonusCredits: 0,
  })

  it('shows the discount still on the subscription (latest reward event), e.g. while past_due', () => {
    const view = build({ canRefer: false, code: null, counting: 3, nextInvoiceAt: null, events: [event(60), event(40)] })
    expect(view.discountLine).toBe('Seu desconto atual: 60% a partir da próxima fatura.')
  })

  it('explains the program when there is no reward event or rewards are inactive', () => {
    const explainer =
      'Cada clínica indicada que está pagando vale 20% de desconto na sua assinatura. Com 5, o FloraClin sai de graça.'
    expect(build({ canRefer: false, code: null, counting: 3, nextInvoiceAt: null }).discountLine).toBe(explainer)
    expect(
      build({ canRefer: false, code: null, counting: 3, rewardsActive: false, events: [event(60)] }).discountLine,
    ).toBe(explainer)
  })
})

describe('sharing', () => {
  it('builds the exact share text and an encoded WhatsApp URL', () => {
    const link = 'https://floraclin.com.br/indicacao/MECA7K'
    const text = referralShareText(link)
    expect(text).toBe(
      `Uso o FloraClin na minha clínica para agenda, prontuário e lembretes por WhatsApp. Se você também é profissional da saúde estética e quer testar, pelo meu link você ganha 14 dias grátis e 20% de desconto nos 2 primeiros meses: ${link}\nGanho desconto na minha assinatura se você assinar. #publi #linkafiliado`,
    )
    const view = build()
    expect(view.link).toBe(link)
    expect(view.shareText).toBe(text)
    expect(view.whatsappShareUrl).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`)
    expect(view.inactiveMessage).toBeNull()
    expect(view.rulesUrl).toBe('https://floraclin.com.br/indique')
  })
})

describe('referral rows and history', () => {
  it('takes labels from the status machine', () => {
    const view = build({
      referrals: [
        {
          id: 'r1',
          referredName: 'B',
          capturedAt: parseBrDate('2026-10-02', '12:00:00'),
          status: 'paused',
          pausedReason: 'past_due',
          ineligibleReason: null,
        },
        {
          id: 'r2',
          referredName: 'C',
          capturedAt: parseBrDate('2026-10-03', '12:00:00'),
          status: 'ineligible',
          pausedReason: null,
          ineligibleReason: 'self_referral',
        },
      ],
    })
    expect(view.referrals.map((r) => [r.label, r.sublabel])).toEqual([
      ['pagante', 'pagamento pendente'],
      ['não elegível', 'mesma clínica ou profissional'],
    ])
  })

  it('formats history rows with singular/plural and the bonus suffix', () => {
    const view = build({
      events: [
        { createdAt: parseBrDate('2026-10-20', '12:00:00'), counting: 6, discountPercent: 100, bonusCredits: 100 },
        { createdAt: parseBrDate('2026-10-10', '12:00:00'), counting: 1, discountPercent: 20, bonusCredits: 0 },
      ],
    })
    expect(view.history).toEqual([
      { date: '20/10/2026', text: 'desconto de 100% com 6 clínicas pagantes · +100 créditos de WhatsApp/mês' },
      { date: '10/10/2026', text: 'desconto de 20% com 1 clínica pagante' },
    ])
  })
})
