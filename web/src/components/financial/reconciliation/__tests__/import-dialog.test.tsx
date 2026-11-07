import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const state = vi.hoisted(() => ({
  data: { total: 2, newLines: 1, duplicateLines: 1, suspects: [] as { index: number }[], alreadyImported: false, warnings: [] as string[], periodStart: '2026-11-01', periodEnd: '2026-11-02' },
  preview: vi.fn(), reset: vi.fn(), commit: vi.fn().mockResolvedValue({ newLines: 1, duplicateLines: 1, alreadyImported: false }),
  pending: false, error: null as Error | null,
}))
vi.mock('@/hooks/queries/use-bank-reconciliation', () => ({
  usePreviewStatementImport: () => ({ data: state.data, mutate: state.preview, reset: state.reset, isPending: state.pending, error: state.error }),
  useCommitStatementImport: () => ({ mutateAsync: state.commit, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { ImportDialog } from '../import-dialog'

const file = new File(['OFX'], 'extrato.ofx')
beforeEach(() => {
  vi.clearAllMocks(); state.data.warnings = []; state.data.suspects = []; state.pending = false; state.error = null
})

describe('OFX preview', () => {
  it('shows compact counts with correct plurals and imports only after confirmation', async () => {
    render(<ImportDialog accountId="bank" file={file} onClose={vi.fn()} />)
    expect(state.preview).toHaveBeenCalledWith({ accountId: 'bank', file })
    expect(screen.getByText('no arquivo')).toBeInTheDocument()
    expect(screen.getByText('novo')).toBeInTheDocument()
    expect(screen.getByText('repetido')).toBeInTheDocument()
    expect(state.commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Importar'))
    await waitFor(() => expect(state.commit).toHaveBeenCalledWith({ accountId: 'bank', file }))
  })

  it('requires a second explicit confirmation for a different account, before duplicate warnings', async () => {
    state.data.warnings = ['A conta do arquivo é diferente da conta selecionada.']
    state.data.suspects = [{ index: 1 }]
    render(<ImportDialog accountId="bank" file={file} onClose={vi.fn()} />)
    expect(screen.getByText('1 possível duplicado')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Importar mesmo assim'))
    expect(state.commit).not.toHaveBeenCalled()
    expect(screen.getByText(/Confirma a importação/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Confirmar importação'))
    await waitFor(() => expect(state.commit).toHaveBeenCalledTimes(1))
  })

  it('blocks import while previewing or after a failed preview', () => {
    state.pending = true
    const view = render(<ImportDialog accountId="bank" file={file} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled()
    state.pending = false; state.error = new Error('Arquivo inválido')
    view.rerender(<ImportDialog accountId="bank" file={file} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled()
    fireEvent.click(screen.getByText('Tentar de novo'))
    expect(state.preview).toHaveBeenCalledTimes(2)
  })
})
