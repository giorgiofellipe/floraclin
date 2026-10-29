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

const appSays = (enrollmentOpen: boolean) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enrollmentOpen, rewardsActive: true }))))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  notFound.mockClear()
})

describe('/indique', () => {
  it('is not found with the switch off and no end date', async () => {
    await expect(IndiquePage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('is not found with the switch on while the app is not fully configured', async () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    appSays(false)
    await expect(IndiquePage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders the table and the ending section with the switch on', async () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    appSays(true)
    const { container } = render(await IndiquePage())
    const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent)
    expect(rows).toEqual(['120%', '240%', '360%', '480%', '5100% (grátis)'])
    expect(container.textContent).toContain(
      'Se a FloraClin decidir encerrar o programa, avisaremos com pelo menos 30 dias de antecedência.',
    )
    expect(container.textContent).not.toContain('O programa será encerrado em')
  })

  it('shows the end notice when an end date is set', async () => {
    vi.stubEnv('REFERRAL_REWARDS_END_AT', '2027-01-15T02:00:00-03:00')
    const { container } = render(await IndiquePage())
    expect(container.textContent).toContain('O programa será encerrado em 15/01/2027.')
  })
})
