// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const accounts = vi.hoisted(() => ({ data: [] as unknown[] }))

vi.mock('@/hooks/queries/use-financial-accounts', () => ({
  useFinancialAccounts: () => ({ data: { data: accounts.data } }),
}))

import { AccountSelect } from '../account-select'

const account = (id: string, kind: string, name: string, isDefault = true) => ({ id, kind, name, isDefault })

beforeEach(() => {
  accounts.data = [account('c', 'cash', 'Caixa'), account('b', 'bank', 'Banco')]
})

describe('AccountSelect', () => {
  it('shows the account the method defaults to, with no dropdown', () => {
    const { rerender } = render(<AccountSelect value={undefined} onChange={vi.fn()} method="cash" />)
    expect(screen.getByTestId('account-line').textContent).toContain('Caixa')
    expect(screen.queryByTestId('account-select')).toBeNull()

    rerender(<AccountSelect value={undefined} onChange={vi.fn()} method="pix" />)
    expect(screen.getByTestId('account-line').textContent).toContain('Banco')
  })

  it('opens the list only after "Trocar conta"', () => {
    render(<AccountSelect value={undefined} onChange={vi.fn()} method="pix" />)
    fireEvent.click(screen.getByText('Trocar conta'))
    expect(screen.getByTestId('account-select')).toBeTruthy()
  })

  it('is hidden when there is nothing to choose, ignoring the legacy account', () => {
    accounts.data = [account('c', 'cash', 'Caixa'), account('l', 'legacy', 'Geral (antes das contas)', false)]
    const { container } = render(<AccountSelect value={undefined} onChange={vi.fn()} method="cash" />)
    expect(container.innerHTML).toBe('')
  })
})
