'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useFinancialAccounts } from '@/hooks/queries/use-financial-accounts'

/**
 * Where a payment's money goes, as a line of text the receptionist can ignore:
 * "Vai para: Caixa" with a "Trocar conta" link that opens the list. Left alone
 * the value stays undefined and the server picks the clinic's default for the
 * method (cash → Caixa, the rest → Banco). Hidden while the clinic has a single
 * account, since there is nothing to choose.
 */
export function AccountSelect({
  value,
  onChange,
  method,
  label = 'Vai para',
}: {
  value: string | undefined
  onChange: (accountId: string | undefined) => void
  /** Payment method, to show which account the server will pick. */
  method?: string | null
  label?: string
}) {
  const { data } = useFinancialAccounts()
  const [changing, setChanging] = useState(false)
  const accounts = (data?.data ?? []).filter((a) => a.kind !== 'legacy')
  if (accounts.length <= 1) return null

  const defaultKind = method === 'cash' ? 'cash' : 'bank'
  const predicted = accounts.find((a) => a.isDefault && a.kind === defaultKind)
  const selected = accounts.find((a) => a.id === value) ?? predicted

  if (!changing) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-3 text-sm" data-testid="account-line">
        <span>
          <span className="text-mid">{label}: </span>
          <span className="font-medium">{selected?.name ?? 'Conta padrão'}</span>
        </span>
        <Button type="button" variant="link" className="h-11 px-2" onClick={() => setChanging(true)}>
          Trocar conta
        </Button>
      </div>
    )
  }

  const items: Record<string, string> = Object.fromEntries(accounts.map((a) => [a.id, a.name]))

  return (
    <div className="space-y-2">
      <Label className="uppercase tracking-wider text-xs font-medium text-mid">{label}</Label>
      <Select
        items={items}
        value={selected?.id}
        onValueChange={(v) => onChange(v && v !== predicted?.id ? v : undefined)}
      >
        <SelectTrigger className="w-full min-h-11" data-testid="account-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent />
      </Select>
    </div>
  )
}
