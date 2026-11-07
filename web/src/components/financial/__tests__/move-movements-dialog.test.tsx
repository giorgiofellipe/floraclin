// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'

const hooks = vi.hoisted(() => ({
  previewInput: null as unknown,
  preview: { moved: 3, skippedReconciled: 1, skippedTransfers: 0, total: '450.00' },
  mutateAsync: vi.fn(),
}))

vi.mock('@/hooks/queries/use-financial-accounts', () => ({
  useMoveMovementsPreview: (input: unknown) => {
    hooks.previewInput = input
    return input ? { data: { data: hooks.preview }, isFetching: false, isError: false } : { isFetching: false, isError: false }
  },
  useMoveMovements: () => ({ mutateAsync: hooks.mutateAsync, isPending: false }),
}))

import { MoveMovementsDialog } from '../move-movements-dialog'

const ACCOUNTS = [
  { id: '11111111-1111-4111-8111-111111111111', kind: 'cash', name: 'Caixa' },
  { id: '22222222-2222-4222-8222-222222222222', kind: 'bank', name: 'Itaú' },
  { id: '33333333-3333-4333-8333-333333333333', kind: 'bank', name: 'Nubank' },
] as Parameters<typeof MoveMovementsDialog>[0]['accounts']

const fromTrigger = () => screen.getByRole('combobox', { name: 'Conta de origem' })
const toTrigger = () => screen.getByRole('combobox', { name: 'Conta de destino' })

async function pick(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, name: string) {
  await user.click(trigger)
  await user.click(await screen.findByRole('option', { name }))
}

// Cache the CSS ancestor check per target; repeated API calls otherwise recompute
// the same portal styles in jsdom. Pointer-interaction checks remain enabled.
function renderBulk() {
  render(<MoveMovementsDialog open onOpenChange={vi.fn()} accounts={ACCOUNTS} target={{ mode: 'account' }} />)
  return userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.EachTarget })
}

beforeEach(() => {
  hooks.previewInput = null
  hooks.preview = { moved: 3, skippedReconciled: 1, skippedTransfers: 0, total: '450.00' }
  hooks.mutateAsync.mockReset()
})

describe('MoveMovementsDialog, whole account', () => {
  it('counts what would move before the user confirms', async () => {
    const user = renderBulk()
    expect(screen.getByRole('button', { name: 'Mover pagamentos' })).toBeDisabled()

    await pick(user, fromTrigger(), 'Caixa')
    await pick(user, toTrigger(), 'Itaú')

    expect(screen.getByTestId('move-preview')).toHaveTextContent('3 pagamentos somando R$ 450,00')
    expect(screen.getByTestId('move-preview')).toHaveTextContent('1 já conciliado fica de fora')
    expect(screen.getByRole('button', { name: /^Mover 3 pagamentos \(R\$\s450,00\)$/ })).toBeEnabled()
  })

  it('stays off when nothing would move', async () => {
    hooks.preview = { moved: 0, skippedReconciled: 2, skippedTransfers: 0, total: '0.00' }
    const user = renderBulk()
    await pick(user, fromTrigger(), 'Caixa')
    await pick(user, toTrigger(), 'Itaú')

    expect(screen.getByTestId('move-preview')).toHaveTextContent('Nenhum pagamento para mover')
    expect(screen.getByRole('button', { name: /^Mover 0 pagamentos \(R\$\s0,00\)$/ })).toBeDisabled()
  })

  it('clears the destination when the source changes', async () => {
    const user = renderBulk()
    await pick(user, fromTrigger(), 'Caixa')
    await pick(user, toTrigger(), 'Itaú')
    await pick(user, fromTrigger(), 'Itaú')

    expect(toTrigger()).toHaveTextContent('Conta de destino')
    expect(hooks.previewInput).toBeNull()
    expect(screen.getByRole('button', { name: 'Mover pagamentos' })).toBeDisabled()
  })

  it('keeps the result on screen, skipped counts included, until closed', async () => {
    hooks.mutateAsync.mockResolvedValue({ data: { moved: 42, skippedReconciled: 3, skippedTransfers: 1 } })
    const onOpenChange = vi.fn()
    render(<MoveMovementsDialog open onOpenChange={onOpenChange} accounts={ACCOUNTS} target={{ mode: 'account' }} />)
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.EachTarget })
    await pick(user, fromTrigger(), 'Caixa')
    await pick(user, toTrigger(), 'Itaú')
    await user.click(screen.getByRole('button', { name: /^Mover 3 pagamentos/ }))

    const result = await screen.findByTestId('move-result')
    expect(result).toHaveAttribute('aria-live', 'polite')
    expect(result).toHaveTextContent('42 movidos · 3 já conciliados · 1 transferência')
    expect(screen.getByRole('heading', { name: 'Pagamentos movidos' })).toBeInTheDocument()
    // The confirm button is gone, so focus must land somewhere the keyboard can reach.
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus()
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('says nothing moved when the payments were reconciled between preview and confirm', async () => {
    hooks.mutateAsync.mockResolvedValue({ data: { moved: 0, skippedReconciled: 3, skippedTransfers: 0 } })
    const user = renderBulk()
    await pick(user, fromTrigger(), 'Caixa')
    await pick(user, toTrigger(), 'Itaú')
    await user.click(screen.getByRole('button', { name: /^Mover 3 pagamentos/ }))

    expect(await screen.findByTestId('move-result')).toHaveTextContent('0 movidos · 3 já conciliados')
    expect(screen.getByRole('heading', { name: 'Nenhum pagamento movido' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Pagamentos movidos' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus()
  })
})

describe('MoveMovementsDialog, one payment', () => {
  it('shows where the payment is now and never offers it as the destination', async () => {
    render(
      <MoveMovementsDialog
        open
        onOpenChange={vi.fn()}
        accounts={ACCOUNTS}
        target={{ mode: 'movements', movementIds: ['44444444-4444-4444-8444-444444444444'], fromAccountId: ACCOUNTS[0].id, fromAccountName: 'Caixa' }}
      />,
    )
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.EachTarget })

    expect(screen.getByTestId('move-current-account')).toHaveTextContent('Caixa')
    await user.click(toTrigger())
    expect(screen.queryByRole('option', { name: 'Caixa' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: 'Nubank' }))
    expect(screen.getByRole('button', { name: 'Mover pagamento' })).toBeEnabled()
    // One payment needs no count: the preview is for the whole-account move.
    expect(hooks.previewInput).toBeNull()
  })
})
