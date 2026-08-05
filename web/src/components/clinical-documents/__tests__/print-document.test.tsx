import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PrintDocument } from '../print-document'
import type { ClinicalDocumentWithContext } from '@/db/queries/clinical-documents'

const BASE_DOC = {
  id: 'doc-1',
  tenantId: 'tenant-1',
  patientId: 'patient-1',
  practitionerId: 'user-1',
  kind: 'atestado',
  title: 'Atestado médico',
  body: 'Atesto para os devidos fins que {{paciente.nome}} esteve sob meus cuidados.',
  templateId: null,
  professionalSnapshot: {
    name: 'Dra. Beatriz Lima',
    registryLine: 'CRM 12345-SP',
    signatureDataUrl: 'data:image/png;base64,abc',
  },
  issuedAt: new Date('2026-03-01T13:00:00Z'),
  deliveredVia: 'download',
  whatsappMessageId: null,
  storagePath: null,
  verificationCode: 'FLC-DOC123',
  createdAt: new Date('2026-03-01T13:00:00Z'),
  updatedAt: new Date('2026-03-01T13:00:00Z'),
  patient: {
    id: 'patient-1',
    fullName: 'Ana Souza',
    cpf: '123.456.789-00',
    birthDate: '1990-05-20',
    phone: '11987654321',
  },
  tenant: {
    id: 'tenant-1',
    name: 'Clínica Teste',
    phone: '11987654321',
    email: 'contato@clinicateste.com.br',
    logoUrl: null,
    address: null,
  },
} as unknown as ClinicalDocumentWithContext

describe('PrintDocument', () => {
  it('renders without throwing, with the FloraClin brand mark and the document content', () => {
    render(<PrintDocument doc={BASE_DOC} />)

    expect(screen.getByText('FloraClin')).toBeInTheDocument()
    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
    expect(screen.getByText('Dra. Beatriz Lima')).toBeInTheDocument()
    expect(screen.getByText('CRM 12345-SP')).toBeInTheDocument()
    expect(screen.getByText(/esteve sob meus cuidados/)).toBeInTheDocument()
  })

  it('still renders the verification code block', () => {
    render(<PrintDocument doc={BASE_DOC} />)
    expect(screen.getByText('FLC-DOC123')).toBeInTheDocument()
  })
})
