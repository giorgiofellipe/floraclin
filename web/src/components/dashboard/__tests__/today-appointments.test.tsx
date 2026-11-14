/**
 * The Painel's "Hoje" list moves each appointment forward in one tap.
 * Before, confirming or checking in took 5 clicks through the agenda.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'
import type { ReactNode } from 'react'
import type { TodayAppointment } from '@/db/queries/dashboard'

const mutate = vi.hoisted(() => vi.fn(async (_vars: unknown) => ({})))
const push = vi.hoisted(() => vi.fn())
const access = vi.hoisted(() => ({ role: 'owner', readOnly: false, openPaywall: vi.fn() }))
const paymentForm = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/hooks/mutations/use-appointment-mutations', () => ({ useUpdateAppointmentStatus: () => ({ mutateAsync: mutate }) }))
vi.mock('@/components/layout/subscription-access', () => ({
  ReadOnlyGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSubscriptionAccess: () => access,
  useWriteGuard: () => (action: () => void) => () => (access.readOnly ? access.openPaywall() : action()),
}))
vi.mock('@/components/financial/payment-form', () => ({
  PaymentForm: (props: Record<string, unknown>) => {
    paymentForm.props = props
    return <div data-testid="payment-form" />
  },
}))

import { TodayAppointments } from '../today-appointments'
import { NEW_APPOINTMENT_PATH } from '@/lib/deep-links'

function appt(overrides: Partial<TodayAppointment> = {}): TodayAppointment {
  return {
    id: 'a1', patientId: 'p1', patientName: 'Ana Souza', bookingName: null, bookingPhone: null,
    procedureTypeName: 'Toxina', startTime: '09:00:00', endTime: '09:30:00', status: 'scheduled', hasCharge: false,
    ...overrides,
  }
}

function renderRows(rows: TodayAppointment[]) {
  return render(<><TodayAppointments appointments={rows} /><Toaster /></>)
}

// The toast's swipe handling calls this; jsdom does not implement it.
beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => {}
})

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(access, { role: 'owner', readOnly: false })
  paymentForm.props = null
})

describe('TodayAppointments row actions', () => {
  // Each action mirrors what the API lets that role do, so no tap ends in a 403.
  it.each([
    ['owner', 'scheduled', false, 'Confirmar'],
    ['receptionist', 'scheduled', false, 'Confirmar'],
    ['financial', 'scheduled', false, null],
    ['owner', 'confirmed', false, 'Iniciar atendimento'],
    ['receptionist', 'confirmed', false, null],
    ['practitioner', 'in_progress', false, 'Abrir atendimento'],
    ['receptionist', 'completed', false, 'Cobrar'],
    ['financial', 'completed', false, 'Cobrar'],
    ['practitioner', 'completed', false, null],
    ['owner', 'completed', true, null],
  ])('%s on a %s row (charged: %s) gets %s', (role, status, hasCharge, label) => {
    access.role = role
    renderRows([appt({ status, hasCharge })])
    const actions = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]
      .map((el) => el.textContent ?? '')
      .filter((text) => /Confirmar|Iniciar atendimento|Abrir atendimento|Cobrar/.test(text))
    expect(actions).toEqual(label ? [expect.stringContaining(label)] : [])
  })

  it('confirms in one tap and undoes from the toast', async () => {
    renderRows([appt({ status: 'scheduled' })])

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Desfazer' }))

    expect(mutate.mock.calls.map(([vars]) => vars)).toEqual([
      { id: 'a1', status: 'confirmed' },
      { id: 'a1', status: 'scheduled' },
    ])
  })

  it('starts the atendimento: marks it in progress and opens the wizard linked to the appointment', async () => {
    renderRows([appt({ status: 'confirmed' })])

    await userEvent.click(screen.getByRole('button', { name: /Iniciar atendimento/ }))

    expect(mutate.mock.calls[0][0]).toEqual({ id: 'a1', status: 'in_progress' })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/pacientes/p1/atendimento?appointment=a1'))
  })

  it('charges a finished appointment that has no charge, linking the charge to it', async () => {
    renderRows([appt({ status: 'completed' })])

    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }))

    expect(paymentForm.props).toMatchObject({ appointmentId: 'a1', defaultPatient: { id: 'p1', fullName: 'Ana Souza' } })
  })

  it('opens the paywall instead of writing from the row menu in read-only mode', async () => {
    access.readOnly = true
    renderRows([appt({ status: 'confirmed' })])

    await userEvent.click(screen.getByRole('button', { name: /Mais ações/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Não compareceu' }))

    expect(access.openPaywall).toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('sends an online booking without a patient record to the prefilled patient form', () => {
    renderRows([appt({ patientId: null, patientName: null, bookingName: 'Bia', bookingPhone: '11999990000' })])
    expect(screen.getByRole('link', { name: 'Cadastrar' })).toHaveAttribute('href', '/pacientes?novo=1&nome=Bia&telefone=11999990000')
  })
})

describe('TodayAppointments empty day', () => {
  it('leads a clinic without appointments to its first one and to the booking link', () => {
    render(<TodayAppointments appointments={[]} firstAppointment bookingUrl="https://app.test/c/clinica" />)
    expect(screen.getByRole('link', { name: /Agendar primeiro atendimento/ })).toHaveAttribute('href', NEW_APPOINTMENT_PATH)
    expect(screen.getByRole('button', { name: /Copiar link de agendamento/ })).toBeInTheDocument()
  })

  it('hides the booking link when online booking is off', () => {
    render(<TodayAppointments appointments={[]} bookingUrl={null} />)
    expect(screen.getByRole('link', { name: 'Agendar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copiar link/ })).not.toBeInTheDocument()
  })
})
