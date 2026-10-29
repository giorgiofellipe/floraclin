import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// The real lookup runs; only the network is stubbed.
const fetchMock = vi.fn()
vi.mock('@/components/home-sections', () => ({
  HomeSections: ({ banner }: { banner?: React.ReactNode }) => (
    <div data-testid="home">{banner}</div>
  ),
}))
vi.mock('@/components/referral-banner', () => ({
  ReferralBanner: ({ clinicName, code }: { clinicName: string; code: string }) => (
    <aside data-testid="banner">{`${clinicName}|${code}`}</aside>
  ),
}))

import ReferralLandingPage from '../page'

async function renderPage(code: string) {
  const ui = await ReferralLandingPage({ params: Promise.resolve({ code }) })
  return render(ui)
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

const json = (body: unknown, ok = true) => ({ ok, json: async () => body })

describe('/indicacao/[code]', () => {
  it('shows the banner for an active code and normalises it', async () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    fetchMock.mockResolvedValue(json({ active: true, clinicName: 'Clínica Flora' }))
    const { getByTestId } = await renderPage('meca7k')
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/referral\/codes\/MECA7K$/)
    expect(getByTestId('banner').textContent).toBe('Clínica Flora|MECA7K')
    expect(getByTestId('home')).toBeInTheDocument()
  })

  it('resolves a clinic-chosen code typed in lowercase', async () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    fetchMock.mockResolvedValue(json({ active: true, clinicName: 'Dra. Micaela' }))
    const { getByTestId } = await renderPage('dramicaela')
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/referral\/codes\/DRAMICAELA$/)
    expect(getByTestId('banner').textContent).toBe('Dra. Micaela|DRAMICAELA')
  })

  it('renders the home without a banner for an inactive code', async () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    fetchMock.mockResolvedValue(json({ active: false }))
    const { queryByTestId, getByTestId } = await renderPage('MECA7K')
    expect(queryByTestId('banner')).toBeNull()
    expect(getByTestId('home')).toBeInTheDocument()
  })

  it('renders the home without a banner for an unknown code (404)', async () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    fetchMock.mockResolvedValue(json({}, false))
    const { queryByTestId, getByTestId } = await renderPage('MECA7K')
    expect(queryByTestId('banner')).toBeNull()
    expect(getByTestId('home')).toBeInTheDocument()
  })

  it('renders the home without a banner when the lookup throws', async () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    fetchMock.mockRejectedValue(new Error('network down'))
    const { queryByTestId, getByTestId } = await renderPage('MECA7K')
    expect(queryByTestId('banner')).toBeNull()
    expect(getByTestId('home')).toBeInTheDocument()
  })

  it('does not look up a malformed code', async () => {
    vi.stubEnv('REFERRAL_ENROLLMENT_ENABLED', 'true')
    const { queryByTestId, getByTestId } = await renderPage('!!bad code!!')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(queryByTestId('banner')).toBeNull()
    expect(getByTestId('home')).toBeInTheDocument()
  })

  it('does not look up anything with the switch off', async () => {
    fetchMock.mockResolvedValue(json({ active: true, clinicName: 'Clínica Flora' }))
    const { queryByTestId, getByTestId } = await renderPage('MECA7K')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(queryByTestId('banner')).toBeNull()
    expect(getByTestId('home')).toBeInTheDocument()
  })
})
