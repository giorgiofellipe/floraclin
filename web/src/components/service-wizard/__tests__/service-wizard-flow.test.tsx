import React, { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, renderWithProviders as render, screen, waitFor } from '@/tests/test-utils'
import type { WizardOverrides } from '../types'
import { brToday, toBrYmd } from '@/lib/dates'
import type { EncounterCart } from '@/validations/encounter-cart'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/hooks/queries/use-face-diagram-groups', () => ({ usePatientDiagramGroups: () => ({ data: [] }) }))
vi.mock('@/components/procedures/encounter-view', () => ({
  encounterViewQueryOptions: (id: string) => ({ queryKey: ['encounter', id], queryFn: async () => ({}) }),
  countPendingSessions: () => 0,
  EncounterViewNotFoundError: class extends Error {},
}))
vi.mock('@/components/patients/send-anamnesis-dialog', () => ({
  SendAnamnesisDialog: ({ label }: { label: string }) => <button type="button">{label}</button>,
}))
vi.mock('@/components/anamnesis/anamnesis-form', () => ({ AnamnesisForm: () => <div>formulário de anamnese</div> }))
vi.mock('@/components/procedures/procedure-approval', () => ({ ProcedureApproval: () => <div>aprovação</div> }))
vi.mock('@/components/procedures/procedure-execution', () => ({ ProcedureExecution: () => <div>execução</div> }))

const botoxLine = {
  procedureTypeId: 'type-1',
  procedureTypeName: 'Botox',
  sessions: 1,
  defaultPrice: 800,
  sourceTemplateLineId: null,
}
vi.mock('../procedure-type-step', () => ({
  ProcedureTypeStep: ({ cart, onCartChange }: { cart: EncounterCart; onCartChange: (c: EncounterCart) => void }) => (
    <button type="button" onClick={() => onCartChange({ ...cart, lines: [botoxLine] })}>
      escolher Botox
    </button>
  ),
}))

const planningSaves: Array<WizardOverrides['validationMode']> = []
vi.mock('@/components/procedures/procedure-form', () => ({
  ProcedureForm: ({ wizardOverrides }: { wizardOverrides: WizardOverrides }) => {
    const trigger = wizardOverrides.triggerSave ?? 0
    useEffect(() => {
      if (trigger === 0) return
      planningSaves.push(wizardOverrides.validationMode)
      wizardOverrides.onSaveComplete?.({ success: true, procedureId: 'rec-1', procedureStatus: 'planned' })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trigger])
    return (
      <button type="button" onClick={() => wizardOverrides.onDirtyChange?.(true)}>
        editar plano
      </button>
    )
  },
}))

import { ServiceWizard } from '../service-wizard'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  planningSaves.length = 0
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/procedures/rec-1')) {
      return new Response(JSON.stringify({ id: 'rec-1', procedureTypeId: 'type-1', status: 'planned' }))
    }
    if (url.includes('/status')) return new Response(JSON.stringify({ success: true }))
    return new Response('[]')
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

const base = {
  patient: { id: 'pat-1', fullName: 'Ana Souza', birthDate: null, phone: '11999990000', cpf: null },
  tenant: { id: 't-1', name: 'Clínica' },
  anamnesisTemplate: { version: 1, sections: [] },
}

function stepHeading() {
  return screen.getAllByRole('heading', { level: 2 }).find((h) => isVisible(h))?.textContent
}

function isVisible(el: HTMLElement) {
  try {
    expect(el).toBeVisible()
    return true
  } catch {
    return false
  }
}

// The phone and desktop bars both render (CSS picks one), so take the first match.
function barButton(name: string | RegExp) {
  return screen.getAllByRole('button', { name })[0]
}

describe('ServiceWizard', () => {
  it('lets a new patient skip the anamnesis instead of blocking the first atendimento', () => {
    render(<ServiceWizard {...base} anamnesis={null} />)

    expect(screen.queryByText('formulário de anamnese')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pular' }))

    expect(stepHeading()).toBe('Planejamento')
  })

  it('picks types and saves the plan in one step, then moves straight to approval', async () => {
    render(<ServiceWizard {...base} anamnesis={null} initialStep={2} />)
    const next = () => barButton(/Próximo/)

    fireEvent.click(next())
    expect(await screen.findByRole('alert')).toHaveTextContent('Selecione ao menos um tipo de procedimento.')
    expect(planningSaves).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'escolher Botox' }))
    fireEvent.click(next())

    await waitFor(() => expect(stepHeading()).toBe('Aprovação'))
    expect(planningSaves).toEqual(['final'])
    expect(barButton(/Aprovar e cobrar/)).toBeInTheDocument()
  })

  const approved = {
    ...base,
    anamnesis: null,
    procedureId: 'rec-1',
    procedureStatus: 'approved' as const,
    procedure: { id: 'rec-1', procedureTypeId: 'type-1', encounterId: 'enc-1' } as never,
  }

  // All steps stay mounted: edits left on planning are lost if X closes without asking.
  it('asks before closing when another step has unsaved edits, and closes straight away otherwise', () => {
    render(<ServiceWizard {...base} anamnesis={null} initialStep={2} />)

    fireEvent.click(barButton('Fechar atendimento'))
    expect(push).toHaveBeenCalledWith('/pacientes/pat-1')
    push.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'escolher Botox' }))
    fireEvent.click(screen.getByRole('button', { name: 'editar plano' }))
    fireEvent.click(barButton('Voltar'))
    fireEvent.click(barButton('Fechar atendimento'))

    expect(screen.getByRole('dialog')).toHaveTextContent('Sair do atendimento?')
    expect(push).not.toHaveBeenCalled()
  })

  // The status card has no form to answer triggerSave; saving through it left the bar on "Salvando...".
  it('leaves from the anamnesis status card on Salvar e sair', () => {
    render(<ServiceWizard {...base} anamnesis={null} />)

    fireEvent.click(barButton('Salvar e sair'))

    expect(push).toHaveBeenCalledWith('/pacientes/pat-1')
  })

  const today = brToday()
  const yesterday = toBrYmd(new Date(Date.now() - 24 * 60 * 60 * 1000))
  const tomorrow = toBrYmd(new Date(Date.now() + 24 * 60 * 60 * 1000))

  async function finish(appointment: { status: string; date: string }) {
    render(<ServiceWizard {...approved} appointment={{ id: 'appt-1', procedureTypeId: null, ...appointment }} />)
    await waitFor(() => expect(barButton('Finalizar atendimento')).toBeEnabled())
    fireEvent.click(barButton('Finalizar atendimento'))
  }

  function statusCalls() {
    return fetchMock.mock.calls.filter(([u]) => String(u) === '/api/appointments/appt-1/status')
  }

  // Records are often finished the day after the visit; that visit must not stay open.
  it.each([
    ['in progress today', 'in_progress', today],
    ['scheduled today', 'scheduled', today],
    ['confirmed yesterday', 'confirmed', yesterday],
  ])('completes an appointment %s, with no confirmation dialog', async (_label, status, date) => {
    await finish({ status, date })

    await waitFor(() => expect(push).toHaveBeenCalledWith('/pacientes/pat-1'))
    expect(statusCalls()[0]?.[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ status: 'completed' }) })
  })

  it.each([
    ['already completed', 'completed', today],
    ['cancelled', 'cancelled', today],
    ['marked no-show', 'no_show', yesterday],
    ['booked for tomorrow', 'scheduled', tomorrow],
  ])('leaves an appointment %s untouched', async (_label, status, date) => {
    await finish({ status, date })

    await waitFor(() => expect(push).toHaveBeenCalledWith('/pacientes/pat-1'))
    expect(statusCalls()).toHaveLength(0)
  })

  it('stays on execution when the appointment cannot be completed, with retry and leave', async () => {
    let failures = 1
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.includes('/status')) return new Response('[]')
      if (failures-- > 0) return new Response(JSON.stringify({ error: 'x' }), { status: 500 })
      return new Response(JSON.stringify({ success: true }))
    })
    await finish({ status: 'in_progress', date: today })

    expect(await screen.findByRole('alert')).toHaveTextContent('O atendimento já está salvo')
    expect(push).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/pacientes/pat-1'))
    expect(statusCalls()).toHaveLength(2)
  })

  it('lets the clinician leave anyway when the appointment update keeps failing', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/status') ? new Response(JSON.stringify({ error: 'x' }), { status: 500 }) : new Response('[]'),
    )
    await finish({ status: 'in_progress', date: today })

    fireEvent.click(await screen.findByRole('button', { name: 'Sair mesmo assim' }))

    expect(push).toHaveBeenCalledWith('/pacientes/pat-1')
  })
})
