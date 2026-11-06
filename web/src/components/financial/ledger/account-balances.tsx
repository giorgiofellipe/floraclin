'use client'

import { cn, formatCurrency } from '@/lib/utils'
import { ACCOUNT_KIND_LABELS } from '@/lib/financial/account-labels'
import type { FinancialAccount } from '@/hooks/queries/use-financial-accounts'

/**
 * Today's balance of each live account: its opening balance plus every
 * movement since. No grand total: the legacy account holds pre-account
 * history, not money in a specific place, so adding it to the others would
 * mislead.
 */
export function AccountBalances({
  accounts,
  selectedId,
  onSelect,
}: {
  accounts: FinancialAccount[]
  selectedId: string
  onSelect: (accountId: string) => void
}) {
  const live = accounts.filter((a) => !a.archivedAt && a.balance !== undefined)
  if (live.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2" data-testid="account-balances">
      {live.map((account) => {
        const selected = selectedId === account.id
        return (
          <button
            key={account.id}
            type="button"
            onClick={() => onSelect(selected ? '' : account.id)}
            aria-pressed={selected}
            className={cn(
              'min-w-[160px] rounded-[3px] border bg-white px-3 py-2 text-left shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-colors',
              selected ? 'border-forest' : 'border-transparent hover:border-sage/30',
            )}
          >
            <span className="block text-[10px] uppercase tracking-[0.15em] text-mid">
              {account.name}
              <span className="normal-case tracking-normal"> · {ACCOUNT_KIND_LABELS[account.kind]}</span>
            </span>
            <span
              className={cn(
                'block text-base font-semibold tabular-nums',
                (account.balance ?? 0) < 0 ? 'text-red-600' : 'text-charcoal',
              )}
            >
              {formatCurrency(account.balance ?? 0)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
