import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/tests/test-utils'
import type { ProfileData } from '@/hooks/queries/use-profile'
import { ProfessionalSignatureForm } from '../professional-signature-form'

const mockState = vi.hoisted(() => ({ mountCount: 0 }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/consent/signature-pad', () => {
  const React = require('react')
  return {
    SignaturePad: function MockSignaturePad({
      onSignatureChange,
    }: {
      onSignatureChange: (data: string | null) => void
      initialData?: string | null
    }) {
      const [mountId] = React.useState(() => {
        mockState.mountCount += 1
        return mockState.mountCount
      })
      return (
        <div data-testid="signature-pad" data-mount-id={mountId}>
          <button
            type="button"
            onClick={() => onSignatureChange('data:image/png;base64,drawn')}
          >
            draw
          </button>
        </div>
      )
    },
  }
})

const emptyProfile: ProfileData = {
  id: 'prof-1',
  fullName: 'Dra. Ana',
  email: 'ana@test.com',
  phone: null,
  signatureData: null,
  signatureUpdatedAt: null,
  professionalTitle: null,
  registryType: null,
  registryNumber: null,
  registryState: null,
}

beforeEach(() => {
  mockState.mountCount = 0
})

describe('ProfessionalSignatureForm', () => {
  it('does not remount the signature pad after the first stroke', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProfessionalSignatureForm initialProfile={emptyProfile} />)

    expect(screen.getByTestId('signature-pad')).toHaveAttribute('data-mount-id', '1')
    expect(mockState.mountCount).toBe(1)

    await user.click(screen.getByRole('button', { name: 'draw' }))

    expect(screen.getByTestId('signature-pad')).toHaveAttribute('data-mount-id', '1')
    expect(mockState.mountCount).toBe(1)
  })

  it('remounts the signature pad when the signature is explicitly removed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProfessionalSignatureForm initialProfile={emptyProfile} />)

    await user.click(screen.getByRole('button', { name: 'draw' }))
    expect(mockState.mountCount).toBe(1)

    await user.click(screen.getByRole('button', { name: /remover assinatura/i }))

    expect(screen.getByTestId('signature-pad')).toHaveAttribute('data-mount-id', '2')
    expect(mockState.mountCount).toBe(2)
  })
})
