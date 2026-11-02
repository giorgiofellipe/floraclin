/**
 * The drop-off changes to the wizard: a two-field first step, "Usar padrões e
 * começar", the action bar pinned to the bottom on phones, and the funnel
 * events for field interactions and abandoned steps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { track } from '@/lib/analytics/client'
import { DEFAULT_PROCEDURE_TYPES, DEFAULT_PRODUCTS } from '@/lib/constants'
import { onboardingCompleteSchema } from '@/validations/onboarding'
import { OnboardingWizard } from '../onboarding-wizard'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/onboarding',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/actions/auth', () => ({ logout: vi.fn() }))
vi.mock('@/lib/analytics/client', () => ({ track: vi.fn(), resetAnalytics: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderWizard(props: Partial<Parameters<typeof OnboardingWizard>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = (
    <OnboardingWizard
      tenantName=""
      tenantPhone={null}
      existingProcedureTypes={[]}
      existingProducts={[]}
      phoneRequired
      {...props}
    />
  )
  return render(<QueryClientProvider client={qc}>{ui as ReactNode}</QueryClientProvider>)
}

const isCompletedCheck = (url: unknown, init: unknown) =>
  url === '/api/onboarding' && ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET'

function onboardingPostBody(fetchMock: { mock: { calls: unknown[][] } }) {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => url === '/api/onboarding' && (init as RequestInit | undefined)?.method === 'POST',
  )
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null
}

function eventsNamed(name: string) {
  return vi.mocked(track).mock.calls.filter(([event]) => event === name)
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  fireEvent(document, new Event('visibilitychange'))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) =>
    Response.json(isCompletedCheck(url, init) ? { completed: false } : { success: true }),
  )
})

afterEach(() => {
  setVisibility('visible')
  vi.restoreAllMocks()
})

describe('step 1 asks only for the clinic name and phone', () => {
  // Regression guard: the long Settings form (address, hours, slug) on the
  // first screen is where a quarter of sign-ups stopped.
  it('has no address, hours, e-mail or booking-link fields', () => {
    renderWizard({ tenantName: 'Clínica Bella' })

    expect(screen.getByLabelText('Nome da clínica *')).toHaveValue('Clínica Bella')
    expect(screen.getByLabelText('Telefone *')).toBeRequired()
    expect(document.querySelectorAll('input')).toHaveLength(2)
    expect(document.querySelector('input[type="time"]')).toBeNull()
    expect(screen.queryByLabelText(/^Rua$/)).toBeNull()
    expect(screen.queryByText(/floraclin\.com\.br\/c\//)).toBeNull()
    expect(screen.queryByLabelText(/E-mail/i)).toBeNull()
  })

  it('autofocuses nothing (no keyboard popping up on load)', () => {
    renderWizard({ tenantName: 'Clínica Bella' })
    for (const input of document.querySelectorAll('input')) expect(input).not.toHaveFocus()
  })

  it('marks the missing field invalid when Próximo stops', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByTestId('onboarding-next'))
    expect(screen.getByLabelText('Nome da clínica *')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('clinic name suggested from the Google account', () => {
  const hint = 'Sugerido a partir da sua conta Google. Ajuste se quiser.'

  it('says where the prefilled name came from until the owner edits it', async () => {
    const user = userEvent.setup()
    renderWizard({ tenantName: 'Clínica Ana Souza', tenantNameSuggested: true })
    const name = screen.getByLabelText('Nome da clínica *')

    expect(name).toHaveAccessibleDescription(hint)

    await user.type(name, ' Estética')

    expect(screen.queryByText(hint)).toBeNull()
    expect(name).not.toHaveAccessibleDescription()
  })

  it('says nothing when the name was not suggested', () => {
    renderWizard({ tenantName: 'Clínica Bella' })
    expect(screen.queryByText(hint)).toBeNull()
    expect(screen.getByLabelText('Nome da clínica *')).not.toHaveAttribute('aria-describedby')
  })
})

describe('"Usar padrões e começar"', () => {
  it('is unavailable until the name and a phone with DDD are filled', async () => {
    const user = userEvent.setup()
    renderWizard()
    const button = screen.getByTestId('onboarding-use-defaults')
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText('Nome da clínica *'), 'Clínica Bella')
    await user.type(screen.getByLabelText('Telefone *'), '9888')
    expect(button).toBeDisabled()

    await user.clear(screen.getByLabelText('Telefone *'))
    await user.type(screen.getByLabelText('Telefone *'), '11988887777')
    expect(button).toBeEnabled()
  })

  it('finishes through the same POST /api/onboarding with the wizard defaults, marked method: defaults', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.mocked(globalThis.fetch)
    renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777' })

    await user.click(screen.getByTestId('onboarding-use-defaults'))

    await waitFor(() => expect(onboardingPostBody(fetchMock)).not.toBeNull())
    const body = onboardingPostBody(fetchMock)
    // Valid for the route's own schema: the same server path as the last step.
    expect(onboardingCompleteSchema.safeParse(body).success).toBe(true)
    expect(body.method).toBe('defaults')
    expect(body.clinic).toEqual({ name: 'Clínica Bella', phone: '(11) 98888-7777' })
    expect(body.procedureTypes.map((p: { name: string }) => p.name)).toEqual(DEFAULT_PROCEDURE_TYPES.map((p) => p.name))
    expect(body.procedureTypes.map((p: { estimatedDurationMin: number }) => p.estimatedDurationMin)).toEqual(
      DEFAULT_PROCEDURE_TYPES.map((p) => p.estimatedDurationMin),
    )
    // The first product of each procedure category, what the products step preselects.
    const categories = new Set<string>(DEFAULT_PROCEDURE_TYPES.map((p) => p.category))
    const firstOfEach = DEFAULT_PRODUCTS.filter(
      (p, i, all) => categories.has(p.category) && all.findIndex((q) => q.category === p.category) === i,
    ).map((p) => p.name)
    expect(firstOfEach.length).toBeGreaterThan(0)
    expect(body.selectedProducts.map((p: { name: string }) => p.name).sort()).toEqual(firstOfEach.sort())
    // No invites on the way.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/invite'))).toBe(false)
  })

  it('lands on the dashboard with the first-patient highlight', async () => {
    const user = userEvent.setup()
    renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777' })
    await user.click(screen.getByTestId('onboarding-use-defaults'))
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard?primeiro_paciente=1'))
  })

  it('ignores the owner\'s edits to later steps: it is the defaults', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.mocked(globalThis.fetch)
    renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777' })
    await user.click(screen.getByTestId('onboarding-next'))
    await user.click(screen.getByRole('checkbox', { name: DEFAULT_PROCEDURE_TYPES[0].name }))
    await user.click(screen.getByTestId('onboarding-prev'))

    await user.click(screen.getByTestId('onboarding-use-defaults'))

    await waitFor(() => expect(onboardingPostBody(fetchMock)).not.toBeNull())
    expect(onboardingPostBody(fetchMock).procedureTypes).toHaveLength(DEFAULT_PROCEDURE_TYPES.length)
  })
})

describe('action bar on phones', () => {
  // Pinning and the room left under the content are layout, which jsdom does
  // not do: the e2e test keeps Próximo in a phone's viewport.
  function stubKeyboard({ wide = false } = {}) {
    const listeners: Record<string, () => void> = {}
    const viewport = {
      height: 800,
      offsetTop: 0,
      addEventListener: (type: string, fn: () => void) => { listeners[type] = fn },
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('visualViewport', viewport)
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: wide && query === '(min-width: 640px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    return () =>
      act(() => {
        viewport.height = 460
        listeners.resize()
      })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rises above the on-screen keyboard from the bottom edge, carrying Próximo', () => {
    const openKeyboard = stubKeyboard()
    renderWizard({ tenantName: 'Clínica Bella' })
    const bar = screen.getByTestId('onboarding-actions')
    expect(bar).toContainElement(screen.getByTestId('onboarding-next'))
    expect(bar.style.transform).toBe('')
    expect(bar.style.bottom).toBe('')

    openKeyboard()

    expect(bar.style.transform).toBe('translateY(-340px)')
    // Not also above the cookie banner, which the keyboard now covers.
    expect(bar.style.bottom).toBe('0px')
  })

  it('is opaque on phones, so the form does not show through it', () => {
    renderWizard({ tenantName: 'Clínica Bella' })
    const bar = screen.getByTestId('onboarding-actions')
    expect(bar).toHaveClass('bg-white')
    expect(bar.className).not.toMatch(/bg-white\/|backdrop-blur/)
  })

  it('makes Próximo full width on phones while there is no Voltar', async () => {
    const user = userEvent.setup()
    renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777' })
    expect(screen.queryByTestId('onboarding-prev')).toBeNull()
    expect(screen.getByTestId('onboarding-next')).toHaveClass('w-full', 'sm:w-auto')

    await user.click(screen.getByTestId('onboarding-next'))

    expect(await screen.findByTestId('onboarding-prev')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-next')).not.toHaveClass('w-full')
  })

  it('stays in place from the sm breakpoint up, where it is in the page flow', () => {
    const openKeyboard = stubKeyboard({ wide: true })
    renderWizard({ tenantName: 'Clínica Bella' })

    openKeyboard()

    expect(screen.getByTestId('onboarding-actions').getAttribute('style')).toBeNull()
  })
})

describe('header legibility', () => {
  it('gives Sair a 44px hit area and readable colour', () => {
    renderWizard({ tenantName: 'Clínica Bella' })
    expect(screen.getByRole('button', { name: 'Sair' })).toHaveClass('min-h-11', 'text-mid')
  })

  it('does not fade the labels of the steps ahead', () => {
    renderWizard({ tenantName: 'Clínica Bella' })
    for (const label of ['Procedimentos', 'Produtos', 'Equipe']) {
      expect(screen.getByText(label).className).not.toMatch(/text-mid\//)
    }
  })
})

describe('field interaction events', () => {
  it('sends one focus and one input event per field for the page, with names only', async () => {
    const user = userEvent.setup()
    renderWizard()
    const name = screen.getByLabelText('Nome da clínica *')
    const phone = screen.getByLabelText('Telefone *')

    await user.type(name, 'Clínica Bella')
    await user.click(phone)
    await user.type(phone, '11988887777')
    await user.click(name)
    await user.type(name, ' Estética')

    const sent = eventsNamed('onboarding_field_interacted').map(([, props]) => props)
    expect(sent).toEqual([
      { step_index: 0, step_name: 'clinic', field: 'name', interaction: 'focus' },
      { step_index: 0, step_name: 'clinic', field: 'name', interaction: 'input' },
      { step_index: 0, step_name: 'clinic', field: 'phone', interaction: 'focus' },
      { step_index: 0, step_name: 'clinic', field: 'phone', interaction: 'input' },
    ])
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toMatch(/Bella|Estética|9888|98888/)
  })

  it('does not send them again after going back to the step', async () => {
    const user = userEvent.setup()
    renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777' })
    await user.click(screen.getByLabelText('Nome da clínica *'))
    await user.click(screen.getByTestId('onboarding-next'))
    await user.click(screen.getByTestId('onboarding-prev'))
    await user.click(screen.getByLabelText('Nome da clínica *'))

    expect(eventsNamed('onboarding_field_interacted')).toHaveLength(1)
  })
})

describe('onboarding_step_abandoned', () => {
  it('is sent by beacon when the page is closed, once per step visit, with the time on the step', async () => {
    renderWizard({ tenantName: 'Clínica Bella' })

    fireEvent(window, new Event('pagehide'))
    fireEvent(window, new Event('beforeunload'))
    fireEvent(window, new Event('pagehide'))

    const sent = eventsNamed('onboarding_step_abandoned')
    expect(sent).toHaveLength(1)
    const [, props, options] = sent[0]
    expect(props).toMatchObject({ step_index: 0, step_name: 'clinic', trigger: 'pagehide' })
    expect((props as { time_on_step_ms: number }).time_on_step_ms).toBeGreaterThanOrEqual(0)
    expect(options).toEqual({ transport: 'sendBeacon' })
  })

  it('is sent on beforeunload, where pagehide does not come first', async () => {
    renderWizard({ tenantName: 'Clínica Bella' })

    fireEvent(window, new Event('beforeunload'))

    expect(eventsNamed('onboarding_step_abandoned')).toEqual([
      ['onboarding_step_abandoned', expect.objectContaining({ step_index: 0, trigger: 'beforeunload' }), { transport: 'sendBeacon' }],
    ])
  })

  // Catches a tab switch counted as abandonment: owners who come back looked like drop-offs.
  it('is not sent when the tab is only hidden', async () => {
    renderWizard({ tenantName: 'Clínica Bella' })

    setVisibility('hidden')
    setVisibility('visible')

    expect(eventsNamed('onboarding_step_abandoned')).toHaveLength(0)
  })

  it('is not sent for moving to the next step, and the new step can send it', async () => {
    const user = userEvent.setup()
    renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777' })
    await user.click(screen.getByTestId('onboarding-next'))
    expect(eventsNamed('onboarding_step_abandoned')).toHaveLength(0)

    fireEvent(window, new Event('pagehide'))

    const sent = eventsNamed('onboarding_step_abandoned')
    expect(sent).toHaveLength(1)
    expect(sent[0][1]).toMatchObject({ step_index: 1, step_name: 'procedures', trigger: 'pagehide' })
  })

  it('is sent when the owner navigates away from the wizard', async () => {
    const { unmount } = renderWizard({ tenantName: 'Clínica Bella' })
    unmount()
    await act(async () => {})

    expect(eventsNamed('onboarding_step_abandoned')).toEqual([
      [
        'onboarding_step_abandoned',
        expect.objectContaining({ step_index: 0, trigger: 'navigation' }),
        { transport: 'sendBeacon' },
      ],
    ])
  })

  it('is not sent when onboarding finishes and the wizard leaves for the dashboard', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777' })
    await user.click(screen.getByTestId('onboarding-use-defaults'))
    await waitFor(() => expect(router.replace).toHaveBeenCalled())
    fireEvent(window, new Event('pagehide'))
    unmount()
    await act(async () => {})

    expect(eventsNamed('onboarding_step_abandoned')).toHaveLength(0)
  })

  it('is not sent when a wizard finished elsewhere is sent on to the dashboard', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) =>
      Response.json(isCompletedCheck(url, init) ? { completed: true } : { success: true }),
    )
    const { unmount } = renderWizard({ tenantName: 'Clínica Bella' })
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard'))
    unmount()
    await act(async () => {})

    expect(eventsNamed('onboarding_step_abandoned')).toHaveLength(0)
  })

  it('is not sent when the owner signs out', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWizard({ tenantName: 'Clínica Bella' })
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    fireEvent(window, new Event('pagehide'))
    unmount()
    await act(async () => {})

    expect(eventsNamed('onboarding_step_abandoned')).toHaveLength(0)
  })

  it('is sent again after a failed finish, if the owner then leaves', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) =>
      isCompletedCheck(url, init) ? Response.json({ completed: false }) : Response.json({ error: 'Erro' }, { status: 500 }),
    )
    renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777' })
    await user.click(screen.getByTestId('onboarding-use-defaults'))
    await waitFor(() => expect(screen.getByTestId('onboarding-use-defaults')).toBeEnabled())

    fireEvent(window, new Event('pagehide'))

    expect(eventsNamed('onboarding_step_abandoned')).toHaveLength(1)
  })
})

describe('onboarding_step_backgrounded', () => {
  // Catches the hidden tab going unrecorded once it stopped counting as abandonment.
  it('is sent by beacon when the tab is hidden, with the step and the time on it', async () => {
    renderWizard({ tenantName: 'Clínica Bella' })

    setVisibility('hidden')

    const sent = eventsNamed('onboarding_step_backgrounded')
    expect(sent).toHaveLength(1)
    const [, props, options] = sent[0]
    expect(props).toMatchObject({ step_index: 0, step_name: 'clinic' })
    expect((props as { time_on_step_ms: number }).time_on_step_ms).toBeGreaterThanOrEqual(0)
    expect(options).toEqual({ transport: 'sendBeacon' })
    expect(eventsNamed('onboarding_step_abandoned')).toHaveLength(0)
  })

  it('is sent once per hide: again after the tab comes back and is hidden again', async () => {
    renderWizard({ tenantName: 'Clínica Bella' })

    setVisibility('hidden')
    setVisibility('hidden')
    expect(eventsNamed('onboarding_step_backgrounded')).toHaveLength(1)

    setVisibility('visible')
    setVisibility('hidden')
    expect(eventsNamed('onboarding_step_backgrounded')).toHaveLength(2)
  })

  it('is not sent while onboarding is finishing', async () => {
    const user = userEvent.setup()
    renderWizard({ tenantName: 'Clínica Bella', tenantPhone: '(11) 98888-7777' })
    await user.click(screen.getByTestId('onboarding-use-defaults'))
    await waitFor(() => expect(router.replace).toHaveBeenCalled())

    setVisibility('hidden')

    expect(eventsNamed('onboarding_step_backgrounded')).toHaveLength(0)
  })
})
