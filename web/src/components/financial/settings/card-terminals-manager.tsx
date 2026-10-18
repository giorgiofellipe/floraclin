'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
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
import {
  useCardTerminals,
  useCreateCardTerminal,
  useDeleteCardTerminal,
  useUpdateCardTerminal,
} from '@/hooks/queries/use-card-terminals'
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
    creditPayoutMode: row.creditPayoutMode as FormState['creditPayoutMode'],
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

function describeTerminal(row: CardTerminalRow): string {
  const credit =
    row.creditPayoutMode === 'lump_sum'
      ? `Crédito em valor único, D+${row.creditLumpSumDays}`
      : 'Crédito por parcela (D+30, D+60...)'
  return `${credit} · Débito D+${row.debitPayoutDays}`
}

export function CardTerminalsManager() {
  const { data, isLoading } = useCardTerminals()
  const terminals = data?.data ?? []
  const createTerminal = useCreateCardTerminal()
  const updateTerminal = useUpdateCardTerminal()
  const deleteTerminal = useDeleteCardTerminal()

  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null)
  const [toDelete, setToDelete] = useState<CardTerminalRow | null>(null)

  const saving = createTerminal.isPending || updateTerminal.isPending

  function patchForm(patch: Partial<FormState>) {
    setEditing((current) => (current ? { ...current, form: { ...current.form, ...patch } } : current))
  }

  async function handleSave() {
    if (!editing) return
    const parsed = cardTerminalSchema.safeParse(toInput(editing.form))
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }
    try {
      if (editing.id) {
        await updateTerminal.mutateAsync({ id: editing.id, ...parsed.data })
        toast.success('Maquininha atualizada com sucesso')
      } else {
        await createTerminal.mutateAsync(parsed.data)
        toast.success('Maquininha criada com sucesso')
      }
      setEditing(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar maquininha')
    }
  }

  async function handleDelete() {
    if (!toDelete) return
    try {
      await deleteTerminal.mutateAsync(toDelete.id)
      toast.success('Maquininha excluída com sucesso')
      setToDelete(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir maquininha')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2Icon className="h-5 w-5 animate-spin text-[#4A6B52]" />
      </div>
    )
  }

  const form = editing?.form

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="uppercase tracking-wider text-xs font-medium text-mid">Maquininhas</h3>
        <div className="flex-1 h-px bg-[#E8ECEF]" />
      </div>

      <div className="space-y-1">
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-[#F4F6F8] transition-colors"
          >
            <span className="flex-1 text-sm text-[#2A2A2A]">
              {terminal.name}
              {terminal.isDefault && (
                <span className="ml-2 rounded bg-[#4A6B52]/10 px-1.5 py-0.5 text-xs text-[#4A6B52]">
                  Padrão
                </span>
              )}
              <span className="text-mid"> · {describeTerminal(terminal)}</span>
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Editar ${terminal.name}`}
                onClick={() => setEditing({ id: terminal.id, form: toForm(terminal) })}
              >
                <PencilIcon className="h-3.5 w-3.5 text-mid" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Excluir ${terminal.name}`}
                onClick={() => setToDelete(terminal)}
              >
                <Trash2Icon className="h-3.5 w-3.5 text-mid" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setEditing({ id: null, form: EMPTY_FORM })}
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Adicionar maquininha
      </Button>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Editar maquininha' : 'Adicionar maquininha'}</DialogTitle>
            <DialogDescription>
              As taxas valem para novas vendas. Vendas já registradas mantêm a taxa original.
            </DialogDescription>
          </DialogHeader>

          {form && (
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
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2Icon className="h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir maquininha</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a maquininha &ldquo;{toDelete?.name}&rdquo;? Vendas já
              registradas não são afetadas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteTerminal.isPending}>
              {deleteTerminal.isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2Icon className="h-4 w-4" />
              )}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
