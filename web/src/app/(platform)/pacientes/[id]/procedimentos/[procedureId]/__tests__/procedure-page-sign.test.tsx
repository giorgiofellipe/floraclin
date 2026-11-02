import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound') } }))
vi.mock('@/hooks/queries/use-patients', () => ({
  usePatient: () => ({ data: { id: 'pat-1', fullName: 'Ana' }, isLoading: false }),
}))
vi.mock('@/hooks/queries/use-procedures', () => ({
  useProcedure: () => ({
    data: { id: 'rec-1', patientId: 'pat-1', status: 'completed', procedureTypeName: 'Botox', diagrams: [] },
    isLoading: false,
  }),
}))
vi.mock('@/hooks/queries/use-tenant', () => ({
  useTenant: () => ({ data: { id: 't-1', name: 'Clínica', settings: null }, isLoading: false }),
}))
vi.mock('@/hooks/queries/use-packages', () => ({ usePatientPackages: () => ({ data: [] }) }))
vi.mock('@/components/procedures/procedure-form', () => ({ ProcedureForm: () => null }))
vi.mock('@/components/procedures/procedure-execution', () => ({ ProcedureExecution: () => null }))
vi.mock('@/components/procedures/procedure-approval', () => ({ ProcedureApproval: () => null }))
vi.mock('@/components/procedures/procedure-detail-view', () => ({
  ProcedureDetailView: () => <div>detalhe</div>,
}))
vi.mock('@/components/procedures/procedure-signatures-panel', () => ({
  ProcedureSignaturesPanel: ({ primaryRecordId }: { primaryRecordId: string }) => (
    <div>painel {primaryRecordId}</div>
  ),
}))

import { ProcedurePageClient } from '../procedure-page-client'

describe('ProcedurePageClient ?action=sign', () => {
  it('shows the signatures panel for a completed procedure', () => {
    render(<ProcedurePageClient patientId="pat-1" procedureId="rec-1" action="sign" />)

    expect(screen.getByText('Assinaturas pendentes')).toBeInTheDocument()
    expect(screen.getByText('painel rec-1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar para Termos/ })).toHaveAttribute(
      'href',
      '/pacientes/pat-1?tab=termos',
    )
    expect(screen.queryByText('detalhe')).not.toBeInTheDocument()
  })
})
