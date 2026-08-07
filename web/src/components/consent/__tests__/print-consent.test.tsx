import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PrintConsent } from '../print-consent'

const BASE_ACCEPTANCE = {
  contentSnapshot: 'Texto do termo de consentimento.',
  contentHash: 'hash-abc',
  signatureData: null,
  signatureEvidence: null,
  professionalSnapshot: null,
  verificationCode: 'FLC-XYZ789',
  acceptedAt: new Date('2026-03-01T13:00:00Z'),
  acceptanceMethod: 'checkbox',
  templateTitle: 'Termo de consentimento - Botox',
  templateType: 'botox',
  templateVersion: 1,
  patientName: 'Ana Souza',
  patientCpf: '123.456.789-00',
  tenantName: 'Clínica Teste',
  tenantPhone: '11987654321',
  tenantEmail: 'contato@clinicateste.com.br',
  tenantLogoUrl: null,
  tenantAddress: null,
}

describe('PrintConsent', () => {
  it('renders without throwing, with the FloraClin brand mark and the tenant/patient content', () => {
    render(<PrintConsent acceptance={BASE_ACCEPTANCE} />)

    expect(screen.getByText('FloraClin')).toBeInTheDocument()
    expect(screen.getByText('Termo de consentimento - Botox')).toBeInTheDocument()
    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
    expect(screen.getByText('Clínica Teste')).toBeInTheDocument()
    expect(screen.getByText('Texto do termo de consentimento.')).toBeInTheDocument()
  })

  it('still renders the verification code block', () => {
    render(<PrintConsent acceptance={BASE_ACCEPTANCE} />)
    expect(screen.getByText('FLC-XYZ789')).toBeInTheDocument()
  })
})
