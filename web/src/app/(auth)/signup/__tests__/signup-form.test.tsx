import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, renderWithProviders as render, screen, waitFor } from '@/tests/test-utils'

const signUp = vi.hoisted(() => vi.fn())
vi.mock('@/actions/signup', () => ({ signUp, signUpWithGoogle: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/components/marketing/signup-attribution-fields', () => ({ SignupAttributionFields: () => null }))

import { SignupForm } from '../signup-form'

beforeEach(() => {
  // The field looks the code up as it is typed; answer as if it were valid.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ active: true }))))
  signUp.mockReset()
  signUp.mockResolvedValue(null)
})

afterEach(() => vi.unstubAllGlobals())

describe('SignupForm referral code field', () => {
  it('is absent when enrollment is off', () => {
    render(<SignupForm referralEnabled={false} defaultReferralCode="MECA7K" />)
    expect(screen.queryByLabelText('Código de indicação')).toBeNull()
    expect(screen.queryByText('Tem um código de indicação?')).toBeNull()
  })

  it('is collapsed behind a link when enrollment is on and there is no default', () => {
    render(<SignupForm referralEnabled defaultReferralCode={null} />)
    expect(screen.queryByLabelText('Código de indicação')).toBeNull()
    fireEvent.click(screen.getByText('Tem um código de indicação?'))
    expect(screen.getByLabelText('Código de indicação')).toHaveValue('')
  })

  it('is open and pre-filled from the default code, and says it is valid, without naming the referrer', async () => {
    render(<SignupForm referralEnabled defaultReferralCode="MECA7K" />)
    expect(screen.getByLabelText('Código de indicação')).toHaveValue('MECA7K')
    await waitFor(() =>
      expect(document.getElementById('referralCodeHint')).toHaveTextContent(
        'Código válido: 20% de desconto nos 2 primeiros meses da assinatura.',
      ),
      { timeout: 2000 },
    )
  })

  it('shows the welcome-offer hint under the empty field, and the label matches the other labels', () => {
    render(<SignupForm referralEnabled defaultReferralCode={null} />)
    fireEvent.click(screen.getByText('Tem um código de indicação?'))
    const input = screen.getByLabelText('Código de indicação')
    const hint = screen.getByText(
      'Tem um código de indicação? Garanta 20% de desconto nos 2 primeiros meses da assinatura.',
    )
    expect(input).toHaveAttribute('aria-describedby', hint.id)
    expect(hint).toHaveClass('text-xs', 'text-mid')
    expect(screen.getByText('Código de indicação').className).toBe(screen.getByText('Telefone').className)
    // Same input classes as its siblings, plus the uppercase display.
    expect(input.className).toBe(`${screen.getByLabelText('Telefone').className} uppercase placeholder:normal-case`)
  })

  it('states the offer under the collapsed link too', () => {
    render(<SignupForm referralEnabled defaultReferralCode={null} />)
    expect(screen.getByText('Garanta 20% de desconto nos 2 primeiros meses da assinatura.')).toHaveClass('text-mid')
  })

  it('submits the pre-filled value', async () => {
    const { container } = render(<SignupForm referralEnabled defaultReferralCode="MECA7K" />)
    fireEvent.submit(container.querySelectorAll('form')[1])
    await waitFor(() => expect(signUp).toHaveBeenCalled())
    const data = signUp.mock.calls[0][1] as FormData
    expect(data.get('referralCode')).toBe('MECA7K')
  })

  it('submits an edited value', async () => {
    const { container } = render(<SignupForm referralEnabled defaultReferralCode="MECA7K" />)
    fireEvent.change(screen.getByLabelText('Código de indicação'), { target: { value: 'ABC234' } })
    fireEvent.submit(container.querySelectorAll('form')[1])
    await waitFor(() => expect(signUp).toHaveBeenCalled())
    expect((signUp.mock.calls[0][1] as FormData).get('referralCode')).toBe('ABC234')
  })

  it('submits no referralCode when enrollment is off', async () => {
    const { container } = render(<SignupForm referralEnabled={false} defaultReferralCode="MECA7K" />)
    fireEvent.submit(container.querySelectorAll('form')[1])
    await waitFor(() => expect(signUp).toHaveBeenCalled())
    expect((signUp.mock.calls[0][1] as FormData).has('referralCode')).toBe(false)
  })
})
