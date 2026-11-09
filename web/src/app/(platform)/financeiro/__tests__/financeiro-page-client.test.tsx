/**
 * The Financeiro sections are a labeled tab row that scrolls on its own on
 * small screens. Links can land on any section (`?tab=<value>`), and the
 * keyboard moves between tabs like any tablist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { FinanceiroPageClient } from '../financeiro-page-client'

const mockReplace = vi.fn()
let searchParamsValue = new URLSearchParams()
let roleValue = 'owner'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => '/financeiro',
  useSearchParams: () => searchParamsValue,
}))

vi.mock('@/hooks/queries/use-financial', () => ({
  useFinancialPatients: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/components/layout/subscription-access', () => ({
  useSubscriptionAccess: () => ({ role: roleValue }),
}))

const { stub } = vi.hoisted(() => ({ stub: () => null }))
vi.mock('@/components/financial/financial-list', () => ({ FinancialList: stub }))
vi.mock('@/components/financial/expenses/expense-list', () => ({ ExpenseList: stub }))
vi.mock('@/components/financial/ledger/ledger-view', () => ({ LedgerView: stub }))
vi.mock('@/components/financial/card-repasses/card-repasses-view', () => ({ CardRepassesView: stub }))
vi.mock('@/components/financial/practitioner-pl/practitioner-pl-view', () => ({ PractitionerPLView: stub }))
vi.mock('@/components/nfse/nfse-documents-list', () => ({ NfseDocumentsList: stub }))
vi.mock('@/components/financial/reconciliation/reconciliation-view', () => ({ ReconciliationView: stub }))
vi.mock('@/components/financial/revenue-chart', () => ({ RevenueChart: stub }))

describe('FinanceiroPageClient tabs', () => {
  beforeEach(() => {
    mockReplace.mockClear()
    searchParamsValue = new URLSearchParams()
    roleValue = 'owner'
  })

  it('leaves out the sections a role cannot open and falls back to A Receber', () => {
    roleValue = 'practitioner'
    searchParamsValue = new URLSearchParams('tab=reconciliation')
    render(<FinanceiroPageClient />)

    const names = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(names).toEqual(['A Receber', 'Despesas', 'Extrato', 'Repasses', 'Por Profissional', 'Visão Geral'])
    expect(screen.getByRole('tab', { name: 'A Receber' })).toHaveAttribute('aria-selected', 'true')
  })

  it('selects the section a link points to and labels the panel with it', async () => {
    searchParamsValue = new URLSearchParams('tab=notas-fiscais')
    // The section is lazy-loaded; let it settle.
    await act(async () => {
      render(<FinanceiroPageClient />)
    })

    const tab = screen.getByRole('tab', { name: 'Notas fiscais' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'A Receber' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Notas fiscais')
  })

  it('moves between sections with the arrow, Home and End keys', () => {
    render(<FinanceiroPageClient />)
    const first = screen.getByRole('tab', { name: 'A Receber' })

    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(mockReplace).toHaveBeenLastCalledWith('/financeiro?tab=expenses', { scroll: false })

    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(mockReplace).toHaveBeenLastCalledWith('/financeiro?tab=notas-fiscais', { scroll: false })

    fireEvent.keyDown(first, { key: 'End' })
    expect(mockReplace).toHaveBeenLastCalledWith('/financeiro?tab=notas-fiscais', { scroll: false })
    expect(screen.getByRole('tab', { name: 'Notas fiscais' })).toHaveFocus()
  })
})
