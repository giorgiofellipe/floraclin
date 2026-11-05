'use client'

import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useFinancialAccounts } from '@/hooks/queries/use-financial-accounts'

const DEFAULT = 'default'

/**
 * Where a payment's money goes. Left on "Conta padrão", the server picks the
 * clinic's default for the method (cash → Caixa, the rest → bank). Hidden
 * until the clinic has accounts: its first payment creates the defaults.
 */
export function AccountSelect({
  value,
  onChange,
  label = 'Conta',
}: {
  value: string | undefined
  onChange: (accountId: string | undefined) => void
  label?: string
}) {
  const { data } = useFinancialAccounts()
  const accounts = data?.data ?? []
  if (accounts.length === 0) return null

  const items: Record<string, string> = {
    [DEFAULT]: 'Conta padrão',
    ...Object.fromEntries(accounts.map((a) => [a.id, a.name])),
  }

  return (
    <div className="space-y-2">
      <Label className="uppercase tracking-wider text-xs font-medium text-mid">{label}</Label>
      <Select
        items={items}
        value={value ?? DEFAULT}
        onValueChange={(v) => onChange(!v || v === DEFAULT ? undefined : v)}
      >
        <SelectTrigger className="w-full" data-testid="account-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent />
      </Select>
    </div>
  )
}
