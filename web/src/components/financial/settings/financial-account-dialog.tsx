'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { DatePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useCreateFinancialAccount,
  useUpdateFinancialAccount,
  type FinancialAccount,
} from '@/hooks/queries/use-financial-accounts'
import {
  createFinancialAccountSchema,
  updateFinancialAccountSchema,
} from '@/validations/financial-accounts'
import { ACCOUNT_KIND_LABELS } from '@/lib/financial/account-labels'

type EditableKind = 'bank' | 'cash' | 'acquirer'

const KIND_ITEMS: Record<EditableKind, string> = {
  bank: ACCOUNT_KIND_LABELS.bank,
  cash: ACCOUNT_KIND_LABELS.cash,
  acquirer: ACCOUNT_KIND_LABELS.acquirer,
}

interface FormState {
  kind: EditableKind
  name: string
  bankName: string
  bankAgency: string
  bankAccount: string
  isDefault: boolean
  openingBalance: string
  openingBalanceDate: string
}

const EMPTY_FORM: FormState = {
  kind: 'bank',
  name: '',
  bankName: '',
  bankAgency: '',
  bankAccount: '',
  isDefault: false,
  openingBalance: '',
  openingBalanceDate: '',
}

function toForm(account: FinancialAccount): FormState {
  return {
    kind: account.kind === 'legacy' ? 'bank' : account.kind,
    name: account.name,
    bankName: account.bankName ?? '',
    bankAgency: account.bankAgency ?? '',
    bankAccount: account.bankAccount ?? '',
    isDefault: account.isDefault,
    openingBalance: account.openingBalance && Number(account.openingBalance) !== 0 ? account.openingBalance.replace('.', ',') : '',
    openingBalanceDate: account.openingBalanceDate ?? '',
  }
}

/** "1.234,56" or "1234.56" → 1234.56; blank is zero. */
function parseAmount(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed
  return Number(normalized)
}

function toInput(form: FormState) {
  return {
    name: form.name,
    bankName: form.bankName,
    bankAgency: form.bankAgency,
    bankAccount: form.bankAccount,
    isDefault: form.kind === 'acquirer' ? false : form.isDefault,
    openingBalance: parseAmount(form.openingBalance),
    openingBalanceDate: form.openingBalanceDate || null,
  }
}

export function FinancialAccountDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: FinancialAccount | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {open && <FinancialAccountForm account={account} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function FinancialAccountForm({ account, onDone }: { account: FinancialAccount | null; onDone: () => void }) {
  const [form, setForm] = useState<FormState>(() => (account ? toForm(account) : EMPTY_FORM))
  const createAccount = useCreateFinancialAccount()
  const updateAccount = useUpdateFinancialAccount()
  const saving = createAccount.isPending || updateAccount.isPending
  const isLegacy = account?.kind === 'legacy'

  function patchForm(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  async function handleSave() {
    const parsed = account
      ? updateFinancialAccountSchema.safeParse(toInput(form))
      : createFinancialAccountSchema.safeParse({ kind: form.kind, ...toInput(form) })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }
    try {
      if (account) {
        await updateAccount.mutateAsync({ id: account.id, ...parsed.data })
        toast.success('Conta atualizada')
      } else {
        await createAccount.mutateAsync(parsed.data as Parameters<typeof createAccount.mutateAsync>[0])
        toast.success('Conta criada')
      }
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar conta')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{account ? 'Editar conta' : 'Adicionar conta'}</DialogTitle>
        <DialogDescription>
          {isLegacy
            ? 'Esta conta guarda as movimentações registradas antes das contas existirem. Só o nome pode ser alterado.'
            : 'Cada movimentação do extrato pertence a uma conta: o caixa da clínica, um banco ou a conta de uma adquirente.'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        {!account && (
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select items={KIND_ITEMS} value={form.kind} onValueChange={(v) => patchForm({ kind: (v ?? 'bank') as EditableKind })}>
              <SelectTrigger className="w-full" aria-label="Tipo de conta">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="account-name">Nome</Label>
          <Input
            id="account-name"
            value={form.name}
            onChange={(e) => patchForm({ name: e.target.value })}
            maxLength={100}
            placeholder={form.kind === 'cash' ? 'Caixa' : 'Itaú PJ'}
          />
        </div>

        {!isLegacy && form.kind === 'bank' && (
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="account-bank">Banco</Label>
              <Input id="account-bank" value={form.bankName} maxLength={100} onChange={(e) => patchForm({ bankName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="account-agency">Agência</Label>
              <Input id="account-agency" value={form.bankAgency} maxLength={20} onChange={(e) => patchForm({ bankAgency: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="account-number">Conta</Label>
              <Input id="account-number" value={form.bankAccount} maxLength={30} onChange={(e) => patchForm({ bankAccount: e.target.value })} />
            </div>
          </div>
        )}

        {!isLegacy && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Saldo inicial (opcional)</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="account-opening">Valor (R$)</Label>
                <Input
                  id="account-opening"
                  inputMode="decimal"
                  value={form.openingBalance}
                  onChange={(e) => patchForm({ openingBalance: e.target.value })}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1">
                <Label>No início do dia</Label>
                <DatePicker
                  value={form.openingBalanceDate}
                  onChange={(v) => patchForm({ openingBalanceDate: v })}
                  className="w-full"
                />
              </div>
            </div>
            <p className="text-xs text-mid">
              O saldo que a conta tinha no começo desse dia. Movimentações anteriores a ele não entram no saldo
              desta conta, para não contar o mesmo dinheiro duas vezes.
            </p>
          </div>
        )}

        {!isLegacy && form.kind !== 'acquirer' && (
          <div className="flex items-center gap-3">
            <Switch
              id="account-default"
              checked={form.isDefault}
              onCheckedChange={(checked) => patchForm({ isDefault: checked })}
            />
            <Label htmlFor="account-default">
              {form.kind === 'cash' ? 'Padrão para pagamentos em dinheiro' : 'Padrão para Pix, transferência e repasses de cartão'}
            </Label>
          </div>
        )}
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2Icon className="h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </DialogFooter>
    </>
  )
}
