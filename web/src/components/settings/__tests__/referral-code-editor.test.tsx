import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders as render } from '@/tests/test-utils'
import { CUSTOM_CODE_MESSAGES, MAX_PREVIOUS_REFERRAL_CODES } from '@/lib/referral/custom-code'
import { ReferralCodeEditor } from '../referral-code-editor'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from 'sonner'

const DEBOUNCE_WAIT = { timeout: 2000 }

type Reply = { status?: number; body: unknown }

/** Routes fetch by method: GET = availability, PUT = save. */
function mockApi({ check, save }: { check?: (code: string) => Reply; save?: Reply }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply =
      init?.method === 'PUT'
        ? (save ?? { body: {} })
        : (check?.(new URL(url, 'http://localhost').searchParams.get('code') ?? '') ?? { body: {} })
    const status = reply.status ?? 200
    return { ok: status < 400, status, json: async () => reply.body } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function openEditor() {
  render(<ReferralCodeEditor currentCode="MECA7K" />)
  fireEvent.click(screen.getByRole('button', { name: 'Personalizar código' }))
  return screen.getByLabelText('Novo código')
}

const saveButton = () => screen.getByRole('button', { name: 'Salvar novo código' }) as HTMLButtonElement

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ReferralCodeEditor', () => {
  it('shows the current code and says the old link and code keep working', () => {
    mockApi({})
    openEditor()
    expect(screen.getByText(/O link e o código atuais \(MECA7K\) continuam funcionando e indicando para você/)).toBeTruthy()
    expect(screen.getByText(/Nenhuma outra clínica poderá usar o código antigo/)).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
  })

  it('checks availability, then saves the uppercased code', async () => {
    const fetchMock = mockApi({
      check: (code) => ({ body: { available: true, code } }),
      save: { body: { code: 'DRAMICAELA' } },
    })
    fireEvent.change(openEditor(), { target: { value: 'draMicaela' } })

    await waitFor(() => expect(screen.getByText('Disponível')).toBeTruthy(), DEBOUNCE_WAIT)
    expect(fetchMock).toHaveBeenCalledWith('/api/referral/code?code=DRAMICAELA', expect.anything())
    expect(saveButton().disabled).toBe(false)

    fireEvent.click(saveButton())
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Código alterado para DRAMICAELA'))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ code: 'DRAMICAELA' })
  })

  it('shows the server reason for a taken code and keeps save disabled', async () => {
    mockApi({ check: () => ({ body: { available: false, reason: 'taken', message: CUSTOM_CODE_MESSAGES.taken } }) })
    fireEvent.change(openEditor(), { target: { value: 'HOFBRASIL' } })

    await waitFor(() => expect(screen.getByText(CUSTOM_CODE_MESSAGES.taken)).toBeTruthy(), DEBOUNCE_WAIT)
    expect(saveButton().disabled).toBe(true)
  })

  it('flags format and reserved codes locally, without asking the server', () => {
    vi.useFakeTimers()
    const fetchMock = mockApi({})
    const input = openEditor()
    fireEvent.change(input, { target: { value: 'DR-A' } })
    expect(screen.getByText(CUSTOM_CODE_MESSAGES.format)).toBeTruthy()
    fireEvent.change(input, { target: { value: 'FLORACLIN' } })
    expect(screen.getByText(CUSTOM_CODE_MESSAGES.reserved)).toBeTruthy()
    fireEvent.change(input, { target: { value: 'meca7k' } })
    expect(screen.getByText('Esse já é o seu código.')).toBeTruthy()

    act(() => vi.advanceTimersByTime(5_000)) // well past the debounce: still no request
    expect(fetchMock).not.toHaveBeenCalled()
    expect(saveButton().disabled).toBe(true)
  })

  it('shows the friendly error when the save loses a race, then re-checks and disables Save', async () => {
    let takenByOther = false
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        takenByOther = true
        return { ok: false, status: 409, json: async () => ({ error: CUSTOM_CODE_MESSAGES.taken }) } as Response
      }
      const body = takenByOther
        ? { available: false, reason: 'taken', message: CUSTOM_CODE_MESSAGES.taken }
        : { available: true, code: 'DRAMICAELA' }
      return { ok: true, status: 200, json: async () => body } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    fireEvent.change(openEditor(), { target: { value: 'DRAMICAELA' } })
    await waitFor(() => expect(saveButton().disabled).toBe(false), DEBOUNCE_WAIT)

    fireEvent.click(saveButton())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(CUSTOM_CODE_MESSAGES.taken))
    await waitFor(() => expect(screen.getByText(CUSTOM_CODE_MESSAGES.taken)).toBeTruthy())
    expect(saveButton().disabled).toBe(true)
    expect(screen.getByLabelText('Novo código')).toBeTruthy() // stays open to pick another
  })

  it('waits until the code is long enough before showing the format error', () => {
    mockApi({})
    const input = openEditor()
    fireEvent.change(input, { target: { value: 'DR' } })
    expect(screen.queryByText(CUSTOM_CODE_MESSAGES.format)).toBeNull()
    fireEvent.change(input, { target: { value: 'DR-' } })
    expect(screen.getByText(CUSTOM_CODE_MESSAGES.format)).toBeTruthy()
  })

  it('lists the old codes that still work', () => {
    mockApi({})
    render(<ReferralCodeEditor currentCode="MECA7K" previousCodes={['DRAMICAELA', 'ABC234']} />)
    expect(screen.getByText(/Códigos anteriores, que continuam funcionando/)).toBeTruthy()
    expect(screen.getByText('DRAMICAELA, ABC234')).toBeTruthy()
  })

  it(`at ${MAX_PREVIOUS_REFERRAL_CODES} old codes, refuses a new one locally but allows switching back`, async () => {
    const fetchMock = mockApi({ check: () => ({ body: { available: true } }) })
    const previous = ['OLD001', 'OLD002', 'OLD003', 'OLD004', 'OLD005']
    render(<ReferralCodeEditor currentCode="MECA7K" previousCodes={previous} />)
    fireEvent.click(screen.getByRole('button', { name: 'Personalizar código' }))
    const input = screen.getByLabelText('Novo código')

    vi.useFakeTimers()
    fireEvent.change(input, { target: { value: 'novocod' } })
    act(() => vi.advanceTimersByTime(1000)) // well past the debounce: a check would have fired by now
    expect(screen.getByText(CUSTOM_CODE_MESSAGES.aliasLimit)).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.useRealTimers()

    fireEvent.change(input, { target: { value: 'old003' } })
    await waitFor(() => expect(screen.getByText('Disponível')).toBeTruthy(), DEBOUNCE_WAIT)
    expect(saveButton().disabled).toBe(false)
  })
})
