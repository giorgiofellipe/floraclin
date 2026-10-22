import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, renderWithProviders as render, screen, waitFor } from '@/tests/test-utils'

const createClinicForOAuthUser = vi.hoisted(() => vi.fn())
vi.mock('@/actions/signup', () => ({ createClinicForOAuthUser }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ update: vi.fn() }) }))
vi.mock('@/components/marketing/signup-attribution-fields', () => ({ SignupAttributionFields: () => null }))
vi.mock('@/lib/marketing-attribution', () => ({ trackMetaEvent: vi.fn() }))

import { ClinicDetailsForm } from '../clinic-details-form'

beforeEach(() => {
  // The field looks the code up as it is typed; answer as if it were valid.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ active: true }))))
  createClinicForOAuthUser.mockReset()
  createClinicForOAuthUser.mockResolvedValue(null)
})

afterEach(() => vi.unstubAllGlobals())

describe('ClinicDetailsForm referral code field', () => {
  it('is absent when enrollment is off', () => {
    render(<ClinicDetailsForm referralEnabled={false} defaultReferralCode="MECA7K" />)
    expect(screen.queryByLabelText('Código de indicação')).toBeNull()
    expect(screen.queryByText('Tem um código de indicação?')).toBeNull()
  })

  it('is collapsed behind a link when enrollment is on and there is no default', () => {
    render(<ClinicDetailsForm referralEnabled defaultReferralCode={null} />)
    expect(screen.queryByLabelText('Código de indicação')).toBeNull()
    fireEvent.click(screen.getByText('Tem um código de indicação?'))
    expect(screen.getByLabelText('Código de indicação')).toHaveValue('')
  })

  it('is open and pre-filled from the default code, and says it is valid, without naming the referrer', async () => {
    render(<ClinicDetailsForm referralEnabled defaultReferralCode="MECA7K" />)
    expect(screen.getByLabelText('Código de indicação')).toHaveValue('MECA7K')
    await waitFor(() =>
      expect(document.getElementById('referralCodeHint')).toHaveTextContent(
        'Código válido: 20% de desconto nos 2 primeiros meses da assinatura.',
      ),
      { timeout: 2000 },
    )
  })

  it('shows the welcome-offer hint under the empty field, with the label styled like the other labels', () => {
    render(<ClinicDetailsForm referralEnabled defaultReferralCode={null} />)
    fireEvent.click(screen.getByText('Tem um código de indicação?'))
    expect(
      screen.getByText('Tem um código de indicação? Garanta 20% de desconto nos 2 primeiros meses da assinatura.'),
    ).toHaveClass('text-xs', 'text-mid')
    expect(screen.getByText('Código de indicação').className).toBe(screen.getByText('Telefone').className)
  })

  it('submits the pre-filled value', async () => {
    const { container } = render(<ClinicDetailsForm referralEnabled defaultReferralCode="MECA7K" />)
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(createClinicForOAuthUser).toHaveBeenCalled())
    expect((createClinicForOAuthUser.mock.calls[0][1] as FormData).get('referralCode')).toBe('MECA7K')
  })

  it('submits an edited value', async () => {
    const { container } = render(<ClinicDetailsForm referralEnabled defaultReferralCode={null} />)
    fireEvent.click(screen.getByText('Tem um código de indicação?'))
    fireEvent.change(screen.getByLabelText('Código de indicação'), { target: { value: 'ABC234' } })
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(createClinicForOAuthUser).toHaveBeenCalled())
    expect((createClinicForOAuthUser.mock.calls[0][1] as FormData).get('referralCode')).toBe('ABC234')
  })

  it('submits no referralCode when enrollment is off', async () => {
    const { container } = render(<ClinicDetailsForm referralEnabled={false} defaultReferralCode="MECA7K" />)
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(createClinicForOAuthUser).toHaveBeenCalled())
    expect((createClinicForOAuthUser.mock.calls[0][1] as FormData).has('referralCode')).toBe(false)
  })
})
