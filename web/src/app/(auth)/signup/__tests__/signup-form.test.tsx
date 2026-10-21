import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const signUp = vi.hoisted(() => vi.fn())
vi.mock('@/actions/signup', () => ({ signUp, signUpWithGoogle: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/components/marketing/signup-attribution-fields', () => ({ SignupAttributionFields: () => null }))

import { SignupForm } from '../signup-form'

beforeEach(() => {
  signUp.mockReset()
  signUp.mockResolvedValue(null)
})

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

  it('is open and pre-filled from the default code', () => {
    render(<SignupForm referralEnabled defaultReferralCode="MECA7K" />)
    expect(screen.getByLabelText('Código de indicação')).toHaveValue('MECA7K')
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
