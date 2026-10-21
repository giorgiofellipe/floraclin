import { describe, expect, it } from 'vitest'
import { planBenefits, recommendedPlanSlug } from '@/lib/plan-benefits'

// The production plans (floraclin.plans, 21/10/2026).
const STARTER = { slug: 'starter', priceCents: 9900, limits: { users: 2, patients: -1, whatsapp_credits: 300 }, features: { own_whatsapp_number: true } }
const PRO = { slug: 'pro', priceCents: 19900, limits: { users: -1, patients: -1, whatsapp_credits: 1000 }, features: { own_whatsapp_number: true } }

describe('planBenefits', () => {
  it('describes each plan from its own limits, at most four lines', () => {
    expect(planBenefits(STARTER)).toEqual([
      'Agenda, prontuário e diagrama facial',
      'Até 2 usuários',
      '300 mensagens de WhatsApp por mês',
      'WhatsApp com o número da clínica',
    ])
    expect(planBenefits(PRO)).toEqual([
      'Agenda, prontuário e diagrama facial',
      'Usuários ilimitados para a equipe',
      '1.000 mensagens de WhatsApp por mês',
      'WhatsApp com o número da clínica',
    ])
  })

  it('never invents a feature the plan lacks', () => {
    const lines = planBenefits({ ...STARTER, features: { own_whatsapp_number: false } })
    expect(lines).not.toContain('WhatsApp com o número da clínica')
    expect(lines).toContain('Pacientes ilimitados')
  })
})

describe('recommendedPlanSlug', () => {
  it('recommends Pro, and nothing when there is only one plan', () => {
    expect(recommendedPlanSlug([STARTER, PRO])).toBe('pro')
    expect(recommendedPlanSlug([STARTER])).toBeNull()
  })
})
