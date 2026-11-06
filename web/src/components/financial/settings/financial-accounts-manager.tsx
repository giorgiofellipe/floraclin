'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ArchiveIcon, ArchiveRestoreIcon, Loader2Icon, PencilIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useFinancialAccounts,
  useSetFinancialAccountArchived,
  type FinancialAccount,
} from '@/hooks/queries/use-financial-accounts'
import { ACCOUNT_KIND_LABELS } from '@/lib/financial/account-labels'
import { cn, formatCurrency } from '@/lib/utils'
import { FinancialAccountDialog } from './financial-account-dialog'

function describeAccount(account: FinancialAccount): string {
  const bank = [account.bankName, account.bankAgency && `ag. ${account.bankAgency}`, account.bankAccount && `cc ${account.bankAccount}`]
    .filter(Boolean)
    .join(' · ')
  return [ACCOUNT_KIND_LABELS[account.kind], bank].filter(Boolean).join(' · ')
}

export function FinancialAccountsManager() {
  const { data, isLoading } = useFinancialAccounts({ includeArchived: true })
  const accounts = data?.data ?? []
  const canManage = data?.canManage ?? false
  const setArchived = useSetFinancialAccountArchived()

  // null: closed; { account: null }: creating; { account }: editing that row.
  const [editing, setEditing] = useState<{ account: FinancialAccount | null } | null>(null)

  async function toggleArchived(account: FinancialAccount) {
    const archived = !account.archivedAt
    try {
      await setArchived.mutateAsync({ id: account.id, archived })
      toast.success(archived ? 'Conta arquivada' : 'Conta reativada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar conta')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2Icon className="h-5 w-5 animate-spin text-sage" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="uppercase tracking-wider text-xs font-medium text-mid">Contas</h3>
        <div className="flex-1 h-px bg-topbar-border" />
      </div>
      <p className="text-xs text-mid">
        Onde o dinheiro da clínica está: o caixa, cada conta bancária e, se quiser acompanhar, a conta da
        adquirente. Pagamentos vão para a conta padrão do método, ou para a escolhida ao registrar.
      </p>

      <div className="space-y-1">
        {accounts.length === 0 && (
          <p className="p-2.5 text-sm text-mid">
            Nenhuma conta ainda. Todo pagamento vai para o Caixa ou para o Banco automaticamente.
          </p>
        )}
        {accounts.map((account) => (
          <div
            key={account.id}
            className={cn(
              'flex items-center gap-3 p-2.5 rounded-lg hover:bg-content-bg transition-colors',
              account.archivedAt && 'opacity-60',
            )}
          >
            <span className="flex-1 text-sm text-charcoal">
              {account.name}
              {account.isDefault && (
                <span className="ml-2 rounded bg-sage/10 px-1.5 py-0.5 text-xs text-sage">Padrão</span>
              )}
              {account.archivedAt && (
                <span className="ml-2 rounded bg-mid/10 px-1.5 py-0.5 text-xs text-mid">Arquivada</span>
              )}
              <span className="text-mid"> · {describeAccount(account)}</span>
            </span>
            {account.balance !== undefined && (
              <span className={cn('text-sm font-medium tabular-nums', account.balance < 0 ? 'text-red-600' : 'text-charcoal')}>
                {formatCurrency(account.balance)}
              </span>
            )}
            {canManage && (
              <div className="flex items-center gap-1">
                {!account.archivedAt && (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Editar ${account.name}`}
                    onClick={() => setEditing({ account })}
                  >
                    <PencilIcon className="h-3.5 w-3.5 text-mid" />
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${account.archivedAt ? 'Reativar' : 'Arquivar'} ${account.name}`}
                  onClick={() => toggleArchived(account)}
                  disabled={setArchived.isPending}
                >
                  {account.archivedAt ? (
                    <ArchiveRestoreIcon className="h-3.5 w-3.5 text-mid" />
                  ) : (
                    <ArchiveIcon className="h-3.5 w-3.5 text-mid" />
                  )}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing({ account: null })}>
          <PlusIcon className="h-3.5 w-3.5" />
          Adicionar conta
        </Button>
      )}

      <FinancialAccountDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        account={editing?.account ?? null}
      />
    </div>
  )
}
