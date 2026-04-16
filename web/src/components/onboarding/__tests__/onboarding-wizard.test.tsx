import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { OnboardingWizard } from '../onboarding-wizard'

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/onboarding',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/actions/auth', () => ({
  logout: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('OnboardingWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders step 1 (Clínica) on mount', () => {
    render(
      wrap(
        <OnboardingWizard
          tenantName="My Clinic"
          existingProcedureTypes={[]}
          existingProducts={[]}
        />,
      ),
    )
    expect(screen.getByText(/Dados da Clínica/i)).toBeInTheDocument()
  })

  it('shows all four step labels in the stepper', () => {
    render(
      wrap(
        <OnboardingWizard
          tenantName="My Clinic"
          existingProcedureTypes={[]}
          existingProducts={[]}
        />,
      ),
    )
    expect(screen.getByText('Clínica')).toBeInTheDocument()
    expect(screen.getByText('Procedimentos')).toBeInTheDocument()
    expect(screen.getByText('Produtos')).toBeInTheDocument()
    expect(screen.getByText('Equipe')).toBeInTheDocument()
  })

  it('accepts existingProducts prop without error', () => {
    // Smoke test: the prop must exist on the component's type
    expect(() =>
      render(
        wrap(
          <OnboardingWizard
            tenantName="My Clinic"
            existingProcedureTypes={[]}
            existingProducts={[]}
          />,
        ),
      ),
    ).not.toThrow()
  })

  it('clicking Próximo advances through steps, reaching Products on step 3', async () => {
    const user = userEvent.setup()
    render(
      wrap(
        <OnboardingWizard
          tenantName="My Clinic"
          existingProcedureTypes={[]}
          existingProducts={[]}
        />,
      ),
    )

    // Step 1 → 2
    await user.click(screen.getByTestId('onboarding-next'))
    expect(screen.getByText(/Tipos de Procedimento/i)).toBeInTheDocument()

    // Step 2 → 3 (Products)
    await user.click(screen.getByTestId('onboarding-next'))
    // The ProductsStep component renders an h2 titled "Produtos"
    expect(
      screen.getByRole('heading', { name: /^Produtos$/, level: 2 }),
    ).toBeInTheDocument()

    // Step 3 → 4 (Team)
    await user.click(screen.getByTestId('onboarding-next'))
    expect(screen.getByText(/Convide sua Equipe/i)).toBeInTheDocument()
  })

  it('sends selectedProducts in the POST body without origin or isCustom', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(
      wrap(
        <OnboardingWizard
          tenantName="My Clinic"
          existingProcedureTypes={[]}
          existingProducts={[]}
        />,
      ),
    )

    // Advance through all steps to reach the Finalizar button on step 4
    await user.click(screen.getByTestId('onboarding-next')) // → 2
    await user.click(screen.getByTestId('onboarding-next')) // → 3 (products)
    await user.click(screen.getByTestId('onboarding-next')) // → 4 (team)

    // Click the complete button
    await user.click(screen.getByTestId('onboarding-complete'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/onboarding',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse((init as RequestInit).body as string)

    expect(Array.isArray(body.selectedProducts)).toBe(true)
    expect(body.selectedProducts.length).toBeGreaterThan(0)

    for (const p of body.selectedProducts) {
      expect(p).toHaveProperty('name')
      expect(p).toHaveProperty('category')
      expect(p).toHaveProperty('activeIngredient')
      expect(p).toHaveProperty('defaultUnit')
      expect(p).not.toHaveProperty('origin')
      expect(p).not.toHaveProperty('isCustom')
    }
  })
})
