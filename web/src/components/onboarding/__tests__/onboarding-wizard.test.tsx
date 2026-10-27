import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { track } from '@/lib/analytics/client'
import { DEFAULT_PROCEDURE_TYPES } from '@/lib/constants'
import { onboardingDraftSchema, onboardingProgressSchema } from '@/validations/onboarding'
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

vi.mock('@/lib/analytics/client', () => ({
  track: vi.fn(),
  resetAnalytics: vi.fn(),
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
          tenantPhone={null}
          tenantEmail={null}
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
          tenantPhone={null}
          tenantEmail={null}
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
            tenantPhone={null}
            tenantEmail={null}
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
          tenantPhone={null}
          tenantEmail={null}
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
          tenantPhone={null}
          tenantEmail={null}
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

    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/onboarding')!
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

  it.each([
    ['a taken booking link', () => Response.json({ error: 'Link em uso' }, { status: 409 }), 'Link em uso', { reason: 'slug_taken', status: 409 }],
    ['invalid data', () => Response.json({ error: 'Dados de onboarding inválidos' }, { status: 400 }), 'Dados de onboarding inválidos', { reason: 'validation', status: 400 }],
    [
      'an expired trial',
      () => Response.json({ error: 'Assinatura expirada', code: 'subscription_expired' }, { status: 402 }),
      'Assinatura expirada',
      { reason: 'subscription_expired', status: 402 },
    ],
    ['a gateway error page', () => new Response('<html>Bad Gateway</html>', { status: 502 }), 'Erro ao completar o onboarding', { reason: 'server_error', status: 502 }],
    [
      'no connection',
      () => Promise.reject(new TypeError('Failed to fetch')),
      'Erro ao completar o onboarding',
      { reason: 'network_error' },
    ],
  ])('reports a failed final save (%s) with its reason, and still tells the owner', async (_, respond, message, expected) => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url) === '/api/onboarding' ? respond() : Response.json({ available: true }),
    )
    render(
      wrap(
        <OnboardingWizard tenantName="My Clinic" tenantPhone={null} tenantEmail={null} existingProcedureTypes={[]} existingProducts={[]} />,
      ),
    )
    await user.click(screen.getByTestId('onboarding-next'))
    await user.click(screen.getByTestId('onboarding-next'))
    await user.click(screen.getByTestId('onboarding-next'))
    await user.click(screen.getByTestId('onboarding-complete'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    expect(vi.mocked(track)).toHaveBeenCalledWith('onboarding_submit_failed', { step_index: 3, step_name: 'team', ...expected })
    // The owner can retry without retyping the wizard.
    await waitFor(() => expect(screen.getByTestId('onboarding-complete')).toBeEnabled())
  })

  // Regression: finishing onboarding erased the signup phone, so lifecycle WhatsApp messages were skipped.
  it('keeps the tenant phone and email when the owner finishes without editing them', async () => {
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
          tenantPhone="(47) 98844-3635"
          tenantEmail="contato@clinica.com.br"
          existingProcedureTypes={[]}
          existingProducts={[]}
        />,
      ),
    )

    await user.click(screen.getByTestId('onboarding-next'))
    await user.click(screen.getByTestId('onboarding-next'))
    await user.click(screen.getByTestId('onboarding-next'))
    await user.click(screen.getByTestId('onboarding-complete'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/onboarding', expect.objectContaining({ method: 'POST' })))
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/onboarding')!
    const body = JSON.parse((init as RequestInit).body as string)

    expect(body.clinic).toMatchObject({ phone: '(47) 98844-3635', email: 'contato@clinica.com.br' })
  })

  // Regression: the link field showed the plain name slug another clinic held, and finishing onboarding failed.
  it('shows the free booking slug the server suggests for the clinic name', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      new Response(
        JSON.stringify(String(input).startsWith('/api/slug-check') ? { available: true, slug: 'my-clinic-1' } : {}),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    render(
      wrap(
        <OnboardingWizard
          tenantName="My Clinic"
          tenantPhone={null}
          tenantEmail={null}
          existingProcedureTypes={[]}
          existingProducts={[]}
        />,
      ),
    )

    expect(await screen.findByDisplayValue('my-clinic-1')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/slug-check?name=My%20Clinic')
  })

  // Regression: the owner could finish with a custom link another clinic held, and onboarding failed.
  it('blocks finishing while the custom booking link is taken', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      const body = url.includes('slug=') ? { available: false } : { available: true, slug: 'my-clinic' }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    render(
      wrap(
        <OnboardingWizard
          tenantName="My Clinic"
          tenantPhone={null}
          tenantEmail={null}
          existingProcedureTypes={[]}
          existingProducts={[]}
        />,
      ),
    )

    const slugInput = await screen.findByDisplayValue('my-clinic')
    await user.clear(slugInput)
    await user.type(slugInput, 'taken-link')
    expect(await screen.findByText('Este link já está em uso. Escolha outro.')).toBeInTheDocument()

    await user.click(screen.getByTestId('onboarding-next'))
    await user.click(screen.getByTestId('onboarding-next'))
    await user.click(screen.getByTestId('onboarding-next'))

    expect(screen.getByTestId('onboarding-complete')).toBeDisabled()
  })

  describe('after a one-step Google sign-up (clinic created with a stand-in name, no phone)', () => {
    function renderFresh() {
      return render(
        wrap(
          <OnboardingWizard
            tenantName=""
            tenantPhone={null}
            tenantEmail={null}
            existingProcedureTypes={[]}
            existingProducts={[]}
            phoneRequired
          />,
        ),
      )
    }

    it('asks for the clinic name from an empty field and the phone as required', () => {
      renderFresh()
      expect(screen.getByLabelText('Nome da Clínica *')).toHaveValue('')
      expect(screen.getByLabelText('Telefone *')).toBeRequired()
      expect(screen.getByText(/dicas da FloraClin por WhatsApp/)).toBeInTheDocument()
    })

    it('does not move on without a phone with DDD', async () => {
      const user = userEvent.setup()
      renderFresh()
      await user.type(screen.getByLabelText('Nome da Clínica *'), 'Clínica Bella')
      await user.type(screen.getByLabelText('Telefone *'), '9888')
      await user.click(screen.getByTestId('onboarding-next'))

      expect(toast.error).toHaveBeenCalledWith('Informe o telefone da clínica com DDD')
      expect(screen.getByText(/Dados da Clínica/i)).toBeInTheDocument()
    })

    it('saves the name and phone typed here', async () => {
      const user = userEvent.setup()
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      renderFresh()
      await user.click(screen.getByTestId('onboarding-next'))
      expect(toast.error).toHaveBeenCalledWith('Nome da clínica é obrigatório')

      await user.type(screen.getByLabelText('Nome da Clínica *'), 'Clínica Bella')
      await user.type(screen.getByLabelText('Telefone *'), '11988887777')
      await user.click(screen.getByTestId('onboarding-next'))
      await user.click(screen.getByTestId('onboarding-next'))
      await user.click(screen.getByTestId('onboarding-next'))
      await user.click(screen.getByTestId('onboarding-complete'))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/onboarding', expect.objectContaining({ method: 'POST' })))
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/onboarding')!
      const body = JSON.parse((call[1] as RequestInit).body as string)
      expect(body.clinic).toMatchObject({ name: 'Clínica Bella', phone: '(11) 98888-7777' })
    })

    it('reports each step it shows, each step passed, and the names (never the values) of fields that stopped it', async () => {
      const user = userEvent.setup()
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      renderFresh()
      await user.click(screen.getByTestId('onboarding-next'))
      await user.type(screen.getByLabelText('Nome da Clínica *'), 'Clínica Bella')
      await user.type(screen.getByLabelText('Telefone *'), '9888')
      await user.click(screen.getByTestId('onboarding-next'))
      await user.clear(screen.getByLabelText('Telefone *'))
      await user.type(screen.getByLabelText('Telefone *'), '11988887777')
      await user.click(screen.getByTestId('onboarding-next'))
      await user.click(screen.getByTestId('onboarding-next'))
      await user.click(screen.getByTestId('onboarding-next'))
      await user.click(screen.getByTestId('onboarding-complete'))

      const clinic = { step_index: 0, step_name: 'clinic' }
      expect(vi.mocked(track).mock.calls).toEqual([
        ['onboarding_step_viewed', clinic],
        ['onboarding_step_validation_error', { ...clinic, fields: ['name'] }],
        ['onboarding_step_validation_error', { ...clinic, fields: ['phone'] }],
        ['onboarding_step_submitted', clinic],
        ['onboarding_step_viewed', { step_index: 1, step_name: 'procedures' }],
        ['onboarding_step_submitted', { step_index: 1, step_name: 'procedures' }],
        ['onboarding_step_viewed', { step_index: 2, step_name: 'products' }],
        ['onboarding_step_submitted', { step_index: 2, step_name: 'products' }],
        ['onboarding_step_viewed', { step_index: 3, step_name: 'team' }],
        ['onboarding_step_submitted', { step_index: 3, step_name: 'team' }],
      ])
      expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toMatch(/Bella|9888|98888/)
    })
  })

  describe('autosave', () => {
    const okResponse = async () => Response.json({ saved: true })
    const progressSaves = (fetchMock: { mock: { calls: unknown[][] } }) =>
      fetchMock.mock.calls
        .filter(([url]) => url === '/api/onboarding/progress')
        .map(([, init]) => init as RequestInit)
    const lastSavedBody = (fetchMock: { mock: { calls: unknown[][] } }) =>
      JSON.parse(progressSaves(fetchMock).at(-1)!.body as string)

    function renderWizard(props: Partial<Parameters<typeof OnboardingWizard>[0]> = {}) {
      return render(
        wrap(
          <OnboardingWizard
            tenantName=""
            tenantPhone={null}
            tenantEmail={null}
            existingProcedureTypes={[]}
            existingProducts={[]}
            phoneRequired
            {...props}
          />,
        ),
      )
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    it('resumes at the saved step with the saved selections', async () => {
      const user = userEvent.setup()
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(okResponse)
      const { unmount } = renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777' })
      const firstProcedure = DEFAULT_PROCEDURE_TYPES[0].name

      await user.click(screen.getByTestId('onboarding-next'))
      await user.click(screen.getByRole('checkbox', { name: firstProcedure }))
      await user.click(screen.getByTestId('onboarding-next'))
      unmount()

      // What the server stores, read back the way the onboarding page reads it.
      const stored = onboardingProgressSchema.parse(lastSavedBody(fetchMock)).draft
      renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777', draft: onboardingDraftSchema.parse(stored) })

      expect(screen.getByRole('heading', { name: /^Produtos$/, level: 2 })).toBeInTheDocument()
      await user.click(screen.getByTestId('onboarding-prev'))
      expect(screen.getByRole('checkbox', { name: firstProcedure })).toHaveAttribute('aria-checked', 'false')
    })

    const atTeamStepDraft = () => onboardingDraftSchema.parse({
      step: 2,
      procedures: [],
      selectedProductNames: [],
      productsTouched: false,
      customProducts: [],
      customSlug: '',
    })

    async function goToTeamStepAndFinish(user: ReturnType<typeof userEvent.setup>) {
      renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777', draft: atTeamStepDraft() })
      await user.click(screen.getByTestId('onboarding-next'))
      await user.click(screen.getByTestId('onboarding-complete'))
    }

    // Regression: an older autosave could land after the final submit wrote
    // the clinic and overwrite it.
    it('sends the final submit only after the autosave in flight answers', async () => {
      const user = userEvent.setup()
      let answerAutosave!: (res: Response) => void
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (url === '/api/onboarding/progress') return new Promise<Response>((r) => { answerAutosave = r })
        return Response.json({ success: true })
      })

      await goToTeamStepAndFinish(user)
      expect(fetchMock).not.toHaveBeenCalledWith('/api/onboarding', expect.anything())

      await act(async () => { answerAutosave(Response.json({ saved: true })) })
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/onboarding', expect.objectContaining({ method: 'POST' })))
    })

    it('keeps unsaved progress for the next autosave when the final submit fails', async () => {
      const user = userEvent.setup()
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        Response.json({ error: 'Erro' }, { status: 500 }),
      )

      await goToTeamStepAndFinish(user)
      await waitFor(() => expect(toast.error).toHaveBeenCalled())
      const savesBefore = progressSaves(fetchMock).length
      fireEvent(window, new Event('pagehide'))

      expect(progressSaves(fetchMock)).toHaveLength(savesBefore + 1)
      expect(lastSavedBody(fetchMock).draft.step).toBe(3)
    })

    // A later step without a saved phone would only fail at the final submit.
    it('opens at the clinic step when its phone was never saved', () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(okResponse)
      const draft = onboardingDraftSchema.parse({
        step: 2,
        procedures: [],
        selectedProductNames: [],
        productsTouched: false,
        customProducts: [],
        customSlug: '',
      })

      renderWizard({ tenantName: 'Clínica Bella', tenantPhone: null, draft })

      expect(screen.getByText(/Dados da Clínica/i)).toBeInTheDocument()
    })
  })
})
