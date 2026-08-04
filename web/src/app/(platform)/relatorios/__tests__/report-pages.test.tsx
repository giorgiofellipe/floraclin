import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/tests/test-utils'

vi.mock('@/hooks/queries/use-appointments', () => ({
  usePractitioners: () => ({ data: [{ id: '11111111-1111-1111-1111-111111111111', fullName: 'Dra. Ana' }] }),
}))

import PacientesInativosPage from '../pacientes-inativos/page'
import RetornosPage from '../retornos/page'
import FaltasPage from '../faltas/page'
import ExtratoPeriodoPage from '../extrato-periodo/page'
import GanhosProfissionalPage from '../ganhos-profissional/page'
import ProcedimentosRealizadosPage from '../procedimentos-realizados/page'

const PRACTITIONER_ID = '11111111-1111-1111-1111-111111111111'

const fetchMock = vi.fn()

/** Query string of the nth (default: latest) request the page fired. */
function requestParams(index = -1): URLSearchParams {
  const calls = fetchMock.mock.calls
  const url = String(calls.at(index)?.[0] ?? '')
  return new URLSearchParams(url.split('?')[1] ?? '')
}

function exportParams(format: 'csv' | 'pdf' = 'csv'): URLSearchParams {
  const href = screen
    .getByRole('link', { name: new RegExp(`exportar ${format}`, 'i') })
    .getAttribute('href')!
  return new URLSearchParams(href.split('?')[1] ?? '')
}

/** Every filter the table asked for must also be in the export URL, so the
 *  downloaded file can't disagree with what is on screen. `format` is the
 *  only key that may differ. */
function expectExportToMatchRequest() {
  const request = requestParams()
  const exported = exportParams()
  for (const [key, value] of request.entries()) {
    expect(exported.get(key), `export URL is missing ${key}`).toBe(value)
  }
  for (const [key, value] of exported.entries()) {
    if (key === 'format') continue
    expect(request.get(key), `table request is missing ${key}`).toBe(value)
  }
}

async function waitForRequests(count: number) {
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(count))
}

beforeEach(() => {
  // Fixed clock: the seeded 90-day window becomes a concrete pair of dates.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-03T15:00:00Z')) // BR noon on 2026-08-03
  fetchMock.mockReset()
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('relatórios pages', () => {
  describe('pacientes-inativos', () => {
    it('sends the seeded default filter on first load and mirrors it in the export URL', async () => {
      renderWithProviders(<PacientesInativosPage />)
      await waitForRequests(1)

      expect(requestParams().get('thresholdDays')).toBe('180')
      expectExportToMatchRequest()
    })

    it('refetches with the new value when the day filter changes', async () => {
      const user = userEvent.setup()
      renderWithProviders(<PacientesInativosPage />)
      await waitForRequests(1)

      const input = screen.getByLabelText(/sem retornar/i)
      await user.clear(input)
      await user.type(input, '45')

      await waitFor(() => expect(requestParams().get('thresholdDays')).toBe('45'))
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
      expectExportToMatchRequest()
    })

    it('shows the report-specific hint when there are no rows', async () => {
      renderWithProviders(<PacientesInativosPage />)

      expect(
        await screen.findByText('Reduza o número de dias sem retornar para incluir mais pacientes.'),
      ).toBeInTheDocument()
    })
  })

  describe('retornos', () => {
    it('sends the day filter under windowDays, in both the request and the export URL', async () => {
      renderWithProviders(<RetornosPage />)
      await waitForRequests(1)

      expect(requestParams().get('windowDays')).toBe('30')
      expect(requestParams().has('thresholdDays')).toBe(false)
      expectExportToMatchRequest()
    })

    it('refetches when the window changes', async () => {
      const user = userEvent.setup()
      renderWithProviders(<RetornosPage />)
      await waitForRequests(1)

      const input = screen.getByLabelText(/próximos e vencidos/i)
      await user.clear(input)
      await user.type(input, '7')

      await waitFor(() => expect(requestParams().get('windowDays')).toBe('7'))
      expectExportToMatchRequest()
    })
  })

  describe('faltas', () => {
    it('seeds both the window and the minimum count', async () => {
      renderWithProviders(<FaltasPage />)
      await waitForRequests(1)

      expect(requestParams().get('windowDays')).toBe('180')
      expect(requestParams().get('minCount')).toBe('2')
      expectExportToMatchRequest()
    })

    it('refetches when the minimum count changes, not just the window', async () => {
      const user = userEvent.setup()
      renderWithProviders(<FaltasPage />)
      await waitForRequests(1)

      const input = screen.getByLabelText(/mínimo de faltas/i)
      await user.clear(input)
      await user.type(input, '4')

      await waitFor(() => expect(requestParams().get('minCount')).toBe('4'))
      expect(requestParams().get('windowDays')).toBe('180')
      expectExportToMatchRequest()
    })
  })

  describe('extrato-periodo', () => {
    it('asks for the seeded last-90-days window and shows it in the inputs', async () => {
      renderWithProviders(<ExtratoPeriodoPage />)
      await waitForRequests(1)

      expect(requestParams().get('dateFrom')).toBe('2026-05-05')
      expect(requestParams().get('dateTo')).toBe('2026-08-03')
      expect(screen.getByText('05/05/2026')).toBeInTheDocument()
      expect(screen.getByText('03/08/2026')).toBeInTheDocument()
      expectExportToMatchRequest()
    })

    it('refetches with the new range when the start date changes', async () => {
      renderWithProviders(<ExtratoPeriodoPage />)
      await waitForRequests(1)

      // Driven with fireEvent rather than userEvent: the date field lives
      // inside a popover trigger that swallows userEvent's synthetic pointer
      // sequence, and this test is about the refetch, not the picker's UX.
      fireEvent.click(screen.getByText('05/05/2026'))
      const input = await screen.findByPlaceholderText('dd/mm/aaaa')
      fireEvent.change(input, { target: { value: '01/01/2026' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => expect(requestParams().get('dateFrom')).toBe('2026-01-01'))
      expect(requestParams().get('dateTo')).toBe('2026-08-03')
      expectExportToMatchRequest()
    })

    it('hints at widening the period when there are no rows', async () => {
      renderWithProviders(<ExtratoPeriodoPage />)

      expect(
        await screen.findByText('Amplie o período para incluir movimentações mais antigas.'),
      ).toBeInTheDocument()
    })
  })

  describe('ganhos-profissional', () => {
    it('asks for the seeded window and no practitioner filter on first load', async () => {
      renderWithProviders(<GanhosProfissionalPage />)
      await waitForRequests(1)

      expect(requestParams().get('dateFrom')).toBe('2026-05-05')
      expect(requestParams().get('dateTo')).toBe('2026-08-03')
      expect(requestParams().has('practitionerId')).toBe(false)
      expectExportToMatchRequest()
    })

    it('refetches when the practitioner changes, keeping the active range', async () => {
      const user = userEvent.setup()
      renderWithProviders(<GanhosProfissionalPage />)
      await waitForRequests(1)

      await user.click(screen.getByRole('combobox'))
      await user.click(await screen.findByText('Dra. Ana'))

      await waitFor(() => expect(requestParams().get('practitionerId')).toBe(PRACTITIONER_ID))
      expect(requestParams().get('dateFrom')).toBe('2026-05-05')
      expectExportToMatchRequest()
    })
  })

  describe('procedimentos-realizados', () => {
    it('asks for the seeded window and mirrors it in the export URL', async () => {
      renderWithProviders(<ProcedimentosRealizadosPage />)
      await waitForRequests(1)

      expect(requestParams().get('dateFrom')).toBe('2026-05-05')
      expect(requestParams().get('dateTo')).toBe('2026-08-03')
      expectExportToMatchRequest()
    })

    it('refetches when the practitioner changes', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ProcedimentosRealizadosPage />)
      await waitForRequests(1)

      await user.click(screen.getByRole('combobox'))
      await user.click(await screen.findByText('Dra. Ana'))

      await waitFor(() => expect(requestParams().get('practitionerId')).toBe(PRACTITIONER_ID))
      expectExportToMatchRequest()
    })
  })
})
