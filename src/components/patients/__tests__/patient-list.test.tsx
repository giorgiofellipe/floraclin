import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PatientList } from '../patient-list'
import type { PaginatedResult } from '@/types'

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/pacientes',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/actions/patients', () => ({
  deletePatientAction: vi.fn(),
}))

// Mock PatientForm to avoid pulling in its dependencies
vi.mock('../patient-form', () => ({
  PatientForm: () => null,
}))

// ─── Helpers ───────────────────────────────────────────────────────

interface PatientStub {
  id: string
  fullName: string
  phone: string
  email: string | null
  cpf: string | null
  createdAt: Date
}

function makeResult(
  patients: PatientStub[],
  overrides: Partial<PaginatedResult<PatientStub>> = {}
): PaginatedResult<PatientStub> {
  return {
    data: patients,
    total: patients.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    ...overrides,
  }
}

function makePatient(overrides: Partial<PatientStub> = {}): PatientStub {
  return {
    id: '1',
    fullName: 'Maria Silva',
    phone: '(11) 99999-0000',
    email: 'maria@test.com',
    cpf: '123.456.789-00',
    createdAt: new Date('2025-01-15'),
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('PatientList', () => {
  it('renders search bar', () => {
    render(<PatientList result={makeResult([]) as any} />)

    expect(
      screen.getByPlaceholderText('Buscar por nome, telefone ou CPF...')
    ).toBeInTheDocument()
  })

  it('renders "Novo Paciente" button', () => {
    render(<PatientList result={makeResult([]) as any} />)

    expect(
      screen.getByRole('button', { name: /novo paciente/i })
    ).toBeInTheDocument()
  })

  it('renders patient rows when data provided', () => {
    const patients = [
      makePatient({ id: '1', fullName: 'Maria Silva' }),
      makePatient({ id: '2', fullName: 'Joao Santos' }),
    ]

    render(<PatientList result={makeResult(patients) as any} />)

    expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    expect(screen.getByText('Joao Santos')).toBeInTheDocument()
  })

  it('shows empty state when no patients', () => {
    render(<PatientList result={makeResult([]) as any} />)

    expect(
      screen.getByText(
        'Nenhum paciente cadastrado. Clique em "Novo Paciente" para começar.'
      )
    ).toBeInTheDocument()
  })
})
