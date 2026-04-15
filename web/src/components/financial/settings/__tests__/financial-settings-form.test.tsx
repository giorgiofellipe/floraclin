import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockSettings = {
  fineType: 'percentage',
  fineValue: '2',
  monthlyInterestPercent: '1',
  gracePeriodDays: 0,
  bankName: null,
  bankAgency: null,
  bankAccount: null,
  pixKeyType: null,
  pixKey: null,
  defaultInstallmentCount: 1,
  defaultPaymentMethod: null,
}

vi.mock('@/hooks/queries/use-financial-settings', () => ({
  useFinancialSettings: () => ({
    data: mockSettings,
    isLoading: false,
  }),
}))

vi.mock('@/hooks/mutations/use-financial-settings-mutations', () => ({
  useUpdateFinancialSettings: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}))

let FinancialSettingsForm: React.ComponentType

beforeAll(async () => {
  const mod = await import('../financial-settings-form')
  FinancialSettingsForm = mod.FinancialSettingsForm
})

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('FinancialSettingsForm', () => {
  it('renders the form with all sections', () => {
    render(<FinancialSettingsForm />, { wrapper: createWrapper() })

    expect(screen.getByText('Multa e Juros')).toBeInTheDocument()
    expect(screen.getByText('Conta Bancária')).toBeInTheDocument()
    expect(screen.getByText('PIX')).toBeInTheDocument()
    expect(screen.getByText('Padrões')).toBeInTheDocument()
  })

  it('renders penalty inputs', () => {
    render(<FinancialSettingsForm />, { wrapper: createWrapper() })

    expect(screen.getByLabelText(/Valor da Multa/)).toBeInTheDocument()
    expect(screen.getByLabelText('Juros Mensais (%)')).toBeInTheDocument()
    expect(screen.getByLabelText('Carência (dias)')).toBeInTheDocument()
  })

  it('renders bank account fields', () => {
    render(<FinancialSettingsForm />, { wrapper: createWrapper() })

    expect(screen.getByLabelText('Banco')).toBeInTheDocument()
    expect(screen.getByLabelText('Agência')).toBeInTheDocument()
    expect(screen.getByLabelText('Conta')).toBeInTheDocument()
  })

  it('renders PIX and defaults fields', () => {
    render(<FinancialSettingsForm />, { wrapper: createWrapper() })

    expect(screen.getByText('Tipo de Chave PIX')).toBeInTheDocument()
    expect(screen.getByLabelText('Chave PIX')).toBeInTheDocument()
    expect(screen.getByLabelText('Parcelas Padrão')).toBeInTheDocument()
    expect(screen.getByText('Método de Pagamento Padrão')).toBeInTheDocument()
  })

  it('renders penalty preview', () => {
    render(<FinancialSettingsForm />, { wrapper: createWrapper() })

    expect(screen.getByTestId('penalty-preview')).toBeInTheDocument()
  })

  it('renders save button', () => {
    render(<FinancialSettingsForm />, { wrapper: createWrapper() })

    expect(screen.getByText('Salvar Configurações')).toBeInTheDocument()
  })
})
