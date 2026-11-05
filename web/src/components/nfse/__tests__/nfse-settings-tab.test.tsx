import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NfseSettingsTab } from '../nfse-settings-tab'

const settings = vi.hoisted(() => ({ clinicAddressComplete: false }))

vi.mock('../certificate-card', () => ({ CertificateCard: () => null }))
vi.mock('@/hooks/queries/use-nfse-settings', () => ({
  NfseApiError: class extends Error {},
  useNfseCertificate: () => ({ data: { cnpj: '12345678000190' } }),
  useNfseSettings: () => ({
    isLoading: false,
    data: { data: null, suggestedMunicipalityCode: null, clinicAddressComplete: settings.clinicAddressComplete },
  }),
  useSaveNfseSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const HINT = /Complete o endereço da clínica em/

async function turnOnFallback() {
  render(<NfseSettingsTab />)
  await userEvent.click(screen.getByRole('switch', { name: /usar o endereço da clínica/ }))
}

describe('NfseSettingsTab clinic address fallback', () => {
  it('points to the clinic settings when the fallback is on but the clinic address is incomplete', async () => {
    settings.clinicAddressComplete = false
    await turnOnFallback()

    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Configurações › Clínica' })).toHaveAttribute('href', '/configuracoes?tab=clinica')
  })

  it('shows no hint when the clinic address is complete', async () => {
    settings.clinicAddressComplete = true
    await turnOnFallback()

    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })
})
