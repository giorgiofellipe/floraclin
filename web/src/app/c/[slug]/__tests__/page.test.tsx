// @vitest-environment node
/**
 * /c/<slug> for a link the clinic moved off: a temporary (307) redirect to its
 * current link for the 90 days findBookingSlugRedirect keeps it
 * (db/queries/__tests__/booking-slugs.test.ts), a 404 otherwise.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redirectMock, findRedirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  }),
  findRedirectMock: vi.fn(),
}))

// Only redirect() is provided: permanentRedirect() (a 308, cached by browsers)
// would be wrong, the old slug can go to another clinic after the 90 days.
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
// No clinic holds the requested slug.
vi.mock('@/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}))
vi.mock('@/db/queries/booking-slugs', () => ({ findBookingSlugRedirect: findRedirectMock }))
vi.mock('@/lib/logo', () => ({ signLogoPath: vi.fn() }))
vi.mock('@/lib/plans', () => ({ isSubscriptionActive: vi.fn() }))
vi.mock('@/components/booking/booking-page', () => ({ BookingPage: () => null }))
vi.mock('@/components/booking/meta-pixel', () => ({ MetaPixel: () => null }))

import PublicBookingPage, { generateMetadata } from '../page'

const params = (slug: string) => ({ params: Promise.resolve({ slug }) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/c/<old-slug>', () => {
  // Catches an old link answering 404 right after the clinic changed it in Settings.
  it('redirects temporarily to the clinic\'s current link', async () => {
    findRedirectMock.mockResolvedValue('ana-estetica')

    await expect(PublicBookingPage(params('clinica-de-ana'))).rejects.toThrow('NEXT_REDIRECT /c/ana-estetica')
    expect(findRedirectMock).toHaveBeenCalledWith('clinica-de-ana')
    expect(redirectMock).toHaveBeenCalledWith('/c/ana-estetica')
    await expect(generateMetadata(params('clinica-de-ana'))).rejects.toThrow('NEXT_REDIRECT /c/ana-estetica')
  })

  it('is a 404 when no clinic moved off it recently', async () => {
    findRedirectMock.mockResolvedValue(null)

    await expect(PublicBookingPage(params('nunca-existiu'))).rejects.toThrow('NEXT_NOT_FOUND')
    expect(redirectMock).not.toHaveBeenCalled()
  })
})
