import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let params = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  notFound: () => {
    throw new Error('notFound')
  },
}))

const PATIENT = 'pat-1'
const APPT = 'a1111111-1111-4111-8111-111111111111'
let latest: Record<string, unknown> | null = null

vi.mock('@/hooks/queries/use-patients', () => ({
  usePatient: () => ({ data: { id: PATIENT, fullName: 'Ana', birthDate: null, phone: '', cpf: null }, isLoading: false }),
}))
vi.mock('@/hooks/queries/use-tenant', () => ({ useTenant: () => ({ data: { id: 't1', name: 'C', settings: {} }, isLoading: false }) }))
vi.mock('@/hooks/queries/use-anamnesis', () => ({
  useAnamnesis: () => ({ data: null, isLoading: false }),
  useAnamnesisTemplate: () => ({ data: { version: 1, sections: [] }, isLoading: false }),
}))
vi.mock('@/hooks/queries/use-procedures', () => ({
  useLatestNonExecutedProcedure: () => ({ data: latest, isLoading: false }),
  useProcedure: (id: string) => ({ data: id ? latest : undefined, isLoading: false }),
}))
vi.mock('@/hooks/queries/use-appointments', () => ({
  useAppointment: (id: string) => ({
    data: id ? { id, patientId: PATIENT, procedureTypeId: 'type-1', status: 'in_progress', date: '2026-11-14' } : undefined,
    isLoading: false,
  }),
}))
vi.mock('@/components/service-wizard/service-wizard', () => ({
  ServiceWizard: (props: { procedureId: string | null; offeredDraft?: { href: string } | null; appointment?: { id: string } | null }) => (
    <div>
      <span data-testid="procedure">{props.procedureId ?? 'novo'}</span>
      <span data-testid="offer">{props.offeredDraft?.href ?? 'sem oferta'}</span>
      <span data-testid="appointment">{props.appointment?.id ?? 'sem agendamento'}</span>
    </div>
  ),
}))

import { AtendimentoPageClient } from '../atendimento-page-client'

function draft(appointmentId: string | null) {
  return { id: 'draft-1', status: 'planned', appointmentId, createdAt: '2026-11-03T15:00:00Z', procedureTypeId: 'type-1' }
}

describe('AtendimentoPageClient opened for an appointment', () => {
  beforeEach(() => {
    params = new URLSearchParams({ appointment: APPT })
    latest = null
  })

  // It used to resume the patient's latest unlinked draft, mixing another visit into this one.
  it('starts a new record and only offers an unlinked draft', async () => {
    latest = draft(null)
    render(<AtendimentoPageClient patientId={PATIENT} />)

    expect(await screen.findByTestId('procedure')).toHaveTextContent('novo')
    expect(screen.getByTestId('offer')).toHaveTextContent(`/pacientes/${PATIENT}/atendimento?appointment=${APPT}&resume=1`)
    expect(screen.getByTestId('appointment')).toHaveTextContent(APPT)
  })

  it('continues the draft when the clinician chooses it', async () => {
    params = new URLSearchParams({ appointment: APPT, resume: '1' })
    latest = draft(null)
    render(<AtendimentoPageClient patientId={PATIENT} />)

    expect(await screen.findByTestId('procedure')).toHaveTextContent('draft-1')
    expect(screen.getByTestId('offer')).toHaveTextContent('sem oferta')
  })

  it("resumes this appointment's own record without asking", async () => {
    latest = draft(APPT)
    render(<AtendimentoPageClient patientId={PATIENT} />)

    expect(await screen.findByTestId('procedure')).toHaveTextContent('draft-1')
  })

  it("neither resumes nor offers a draft that belongs to another appointment", async () => {
    latest = draft('b2222222-2222-4222-8222-222222222222')
    render(<AtendimentoPageClient patientId={PATIENT} />)

    expect(await screen.findByTestId('procedure')).toHaveTextContent('novo')
    expect(screen.getByTestId('offer')).toHaveTextContent('sem oferta')
  })
})
