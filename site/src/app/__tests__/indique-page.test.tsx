import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
)
vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/components/navigation', () => ({ Navigation: () => null }))
vi.mock('@/components/footer', () => ({ Footer: () => null }))

import IndiquePage from '../indique/page'

afterEach(() => {
  vi.unstubAllEnvs()
  notFound.mockClear()
})

describe('/indique', () => {
  it('is not found with the switch off and no end date', () => {
    expect(() => IndiquePage()).toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('renders the table and the ending section with the switch on', () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    const { container } = render(IndiquePage())
    const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent)
    expect(rows).toEqual(['120%', '240%', '360%', '480%', '5100% (grátis)'])
    expect(container.textContent).toContain(
      'Se a FloraClin decidir encerrar o programa, avisaremos com pelo menos 30 dias de antecedência.',
    )
    expect(container.textContent).not.toContain('O programa será encerrado em')
  })

  it('shows the end notice when an end date is set', () => {
    vi.stubEnv('REFERRAL_REWARDS_END_AT', '2027-01-15T02:00:00-03:00')
    const { container } = render(IndiquePage())
    expect(container.textContent).toContain('O programa será encerrado em 15/01/2027.')
  })
})
