'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateCardTerminal, useUpdateCardTerminal } from '@/hooks/queries/use-card-terminals'
import { cardTerminalSchema, type CardTerminalInput } from '@/validations/card-terminals'
import type { CardTerminalRow } from '@/db/queries/card-terminals'

interface FormState {
  name: string
  isDefault: boolean
  debitRate: string
  debitPayoutDays: string
  creditRates: string[]
  creditPayoutMode: CardTerminalInput['creditPayoutMode']
  creditLumpSumDays: string
}

const EMPTY_FORM: FormState = {
  name: '',
  isDefault: false,
  debitRate: '',
  debitPayoutDays: '1',
  creditRates: Array.from({ length: 12 }, () => ''),
  creditPayoutMode: 'per_installment',
  creditLumpSumDays: '1',
}

function toForm(row: CardTerminalRow): FormState {
  return {
    name: row.name,
    isDefault: row.isDefault,
    debitRate: row.debitRate,
    debitPayoutDays: String(row.debitPayoutDays),
    creditRates: row.creditRates,
    creditPayoutMode: row.creditPayoutMode,
    creditLumpSumDays: String(row.creditLumpSumDays),
  }
}

const toNumber = (text: string) => (text.trim() === '' ? NaN : Number(text.replace(',', '.')))

function toInput(form: FormState): unknown {
  return {
    name: form.name,
    isDefault: form.isDefault,
    debitRate: toNumber(form.debitRate),
    debitPayoutDays: toNumber(form.debitPayoutDays),
    creditRates: form.creditRates.map(toNumber),
    creditPayoutMode: form.creditPayoutMode,
    creditLumpSumDays: toNumber(form.creditLumpSumDays),
  }
}

interface CardTerminalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  terminal?: CardTerminalRow | null
  onCreated?: (terminal: CardTerminalRow) => void
}

export function CardTerminalDialog({ open, onOpenChange, terminal, onCreated }: CardTerminalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {open && (
          <CardTerminalForm
            terminal={terminal ?? null}
            onDone={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CardTerminalForm({
  terminal,
  onDone,
  onCreated,
}: {
  terminal: CardTerminalRow | null
  onDone: () => void
  onCreated?: (terminal: CardTerminalRow) => void
}) {
  const [form, setForm] = useState<FormState>(() => (terminal ? toForm(terminal) : EMPTY_FORM))
  const createTerminal = useCreateCardTerminal()
  const updateTerminal = useUpdateCardTerminal()
  const saving = createTerminal.isPending || updateTerminal.isPending

  function patchForm(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  async function handleSave() {
    const parsed = cardTerminalSchema.safeParse(toInput(form))
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }
    try {
      if (terminal) {
        await updateTerminal.mutateAsync({ id: terminal.id, ...parsed.data })
        toast.success('Maquininha atualizada com sucesso')
      } else {
        const created = await createTerminal.mutateAsync(parsed.data)
        toast.success('Maquininha criada com sucesso')
        onCreated?.(created.data)
      }
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar maquininha')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{terminal ? 'Editar maquininha' : 'Adicionar maquininha'}</DialogTitle>
        <DialogDescription>
          As taxas valem para novas vendas. Vendas já registradas mantêm a taxa original.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="terminal-name">Nome</Label>
          <Input
            id="terminal-name"
            value={form.name}
            onChange={(e) => patchForm({ name: e.target.value })}
            maxLength={100}
          />
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium">Débito</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="debit-rate">Taxa (%)</Label>
              <Input
                id="debit-rate"
                inputMode="decimal"
                value={form.debitRate}
                onChange={(e) => patchForm({ debitRate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="debit-days">Repasse em (dias úteis)</Label>
              <Input
                id="debit-days"
                inputMode="numeric"
                value={form.debitPayoutDays}
                onChange={(e) => patchForm({ debitPayoutDays: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium">Crédito: taxa por número de parcelas (%)</h4>
          <div className="grid grid-cols-4 gap-3">
            {form.creditRates.map((rate, i) => (
              <div key={i} className="space-y-1">
                <Label htmlFor={`credit-rate-${i + 1}`}>{i + 1}x</Label>
                <Input
                  id={`credit-rate-${i + 1}`}
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) =>
                    patchForm({
                      creditRates: form.creditRates.map((r, j) => (j === i ? e.target.value : r)),
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Como o crédito é repassado</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="credit-payout-mode"
              checked={form.creditPayoutMode === 'per_installment'}
              onChange={() => patchForm({ creditPayoutMode: 'per_installment' })}
            />
            Por parcela: uma a cada 30 dias (D+30, D+60...)
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="radio"
              name="credit-payout-mode"
              checked={form.creditPayoutMode === 'lump_sum'}
              onChange={() => patchForm({ creditPayoutMode: 'lump_sum' })}
            />
            Valor único (antecipação automática) em D+
            <Input
              aria-label="Dias úteis do valor único"
              className="w-16"
              inputMode="numeric"
              value={form.creditLumpSumDays}
              onChange={(e) => patchForm({ creditLumpSumDays: e.target.value })}
              disabled={form.creditPayoutMode !== 'lump_sum'}
            />
            dias úteis
          </label>
        </fieldset>

        <div className="flex items-center gap-3">
          <Switch
            id="terminal-default"
            checked={form.isDefault}
            onCheckedChange={(checked) => patchForm({ isDefault: checked })}
          />
          <Label htmlFor="terminal-default">Padrão</Label>
        </div>
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
