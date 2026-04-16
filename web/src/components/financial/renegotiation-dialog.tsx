'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { DatePicker } from '@/components/ui/date-picker'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRenegotiate } from '@/hooks/mutations/use-financial-mutations'
import { formatCurrency } from '@/lib/utils'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { addDays } from 'date-fns'
import { toLocalYmd } from '@/lib/dates'

const INSTALLMENT_COUNT_ITEMS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => [String(i + 1), `${i + 1}x`])
)

interface RenegotiationEntry {
  id: string
  description: string
  patientName: string
  remainingPrincipal: number
  fineAmount: number
  interestAmount: number
}

interface RenegotiationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: RenegotiationEntry[]
  onSuccess?: () => void
}

export function RenegotiationDialog({
  open,
  onOpenChange,
  entries,
  onSuccess,
}: RenegotiationDialogProps) {
  const patientName = entries[0]?.patientName ?? ''
  const [description, setDescription] = useState(
    `Renegociação — ${patientName}`,
  )
  const [installmentCount, setInstallmentCount] = useState('1')
  const [waivePenalties, setWaivePenalties] = useState(false)
  const [waiveAmountStr, setWaiveAmountStr] = useState('')
  const [customTotalStr, setCustomTotalStr] = useState('')
  const [customDueDates, setCustomDueDates] = useState<Record<number, string>>({})

  const renegotiate = useRenegotiate()
  const isPending = renegotiate.isPending

  const totals = useMemo(() => {
    let principal = 0
    let penalties = 0
    for (const entry of entries) {
      principal += entry.remainingPrincipal
      penalties += entry.fineAmount + entry.interestAmount
    }
    return { principal, penalties, total: principal + penalties }
  }, [entries])

  const waiveAmount = waivePenalties
    ? waiveAmountStr
      ? Math.min(parseCurrency(waiveAmountStr), totals.penalties)
      : totals.penalties
    : 0

  const calculatedTotal = totals.total - waiveAmount
  const customTotal = customTotalStr ? parseCurrency(customTotalStr) : 0
  const finalTotal = customTotal > 0 ? customTotal : calculatedTotal

  const parsedCount = parseInt(installmentCount, 10) || 1

  const installmentPreview = useMemo(() => {
    if (finalTotal <= 0 || parsedCount < 1) return []

    const installmentAmount = Math.floor((finalTotal * 100) / parsedCount) / 100
    const remainder = Math.round((finalTotal - installmentAmount * parsedCount) * 100) / 100
    const today = new Date()

    return Array.from({ length: parsedCount }, (_, i) => {
      const amount = i === 0 ? installmentAmount + remainder : installmentAmount
      const defaultDate = toLocalYmd(addDays(today, i * 30))
      return {
        number: i + 1,
        amount,
        dueDate: customDueDates[i] ?? defaultDate,
      }
    })
  }, [finalTotal, parsedCount, customDueDates])

  async function handleConfirm() {
    if (finalTotal <= 0) return
    const dueDates = installmentPreview.map((inst) => inst.dueDate)
    try {
      await renegotiate.mutateAsync({
        entryIds: entries.map((e) => e.id),
        newInstallmentCount: parsedCount,
        newTotalAmount: customTotal > 0 ? customTotal : undefined,
        description,
        waivePenalties,
        waiveAmount,
        customDueDates: dueDates,
      })
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao processar')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-charcoal">Renegociação</DialogTitle>
          <DialogDescription className="text-mid">
            Consolide as cobranças selecionadas em uma nova cobrança.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto">
          {/* Original charges summary */}
          <div className="rounded-lg border border-[#E8ECEF] overflow-hidden">
            <div className="px-3 py-2 bg-[#F4F6F8] border-b border-[#E8ECEF]">
              <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium">
                Cobranças originais
              </span>
            </div>
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between px-3 py-2 border-b border-[#E8ECEF] last:border-b-0">
                <span className="text-sm text-charcoal truncate flex-1">{entry.description}</span>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-sm tabular-nums">{formatCurrency(entry.remainingPrincipal)}</span>
                  {(entry.fineAmount + entry.interestAmount) > 0 && (
                    <span className="text-xs tabular-nums text-amber-700">
                      +{formatCurrency(entry.fineAmount + entry.interestAmount)}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 bg-[#F4F6F8]">
              <span className="text-sm font-medium text-charcoal">Total</span>
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium tabular-nums">{formatCurrency(totals.principal)}</span>
                {totals.penalties > 0 && (
                  <span className="text-xs font-medium tabular-nums text-amber-700">
                    +{formatCurrency(totals.penalties)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Waive penalties */}
          {totals.penalties > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Switch
                  checked={waivePenalties}
                  onCheckedChange={setWaivePenalties}
                />
                <Label className="text-sm text-charcoal cursor-pointer">
                  Dispensar multa/juros
                </Label>
              </div>
              {waivePenalties && (
                <div className="space-y-2">
                  <Label className="uppercase tracking-wider text-xs font-medium text-mid">
                    Valor a dispensar (max {formatCurrency(totals.penalties)})
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-charcoal">
                      R$
                    </span>
                    <MaskedInput
                      mask={maskCurrency}
                      value={waiveAmountStr}
                      onChange={(e) => setWaiveAmountStr(e.target.value)}
                      placeholder={maskCurrency(String(Math.round(totals.penalties * 100)))}
                      className="pl-10"
                      inputMode="numeric"
                    />
                  </div>
                  <p className="text-xs text-mid">Deixe em branco para dispensar o total de encargos.</p>
                </div>
              )}
            </div>
          )}

          {/* New charge details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Descrição</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Renegociação — Paciente"
              />
            </div>

            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Novo valor total (opcional)</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-charcoal">
                  R$
                </span>
                <MaskedInput
                  mask={maskCurrency}
                  value={customTotalStr}
                  onChange={(e) => setCustomTotalStr(e.target.value)}
                  placeholder={maskCurrency(String(Math.round(calculatedTotal * 100)))}
                  className="pl-10"
                  inputMode="numeric"
                />
              </div>
              <p className="text-xs text-mid">
                Deixe em branco para usar {formatCurrency(calculatedTotal)}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Parcelas</Label>
            <Select
              items={INSTALLMENT_COUNT_ITEMS}
              value={installmentCount}
              onValueChange={(v) => {
                setInstallmentCount(v ?? '1')
                setCustomDueDates({})
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>

          {/* Installment preview with editable dates */}
          {installmentPreview.length > 0 && finalTotal > 0 && (
            <div className="rounded-lg border border-[#E8ECEF] overflow-hidden">
              <div className="px-3 py-2 bg-[#F4F6F8] border-b border-[#E8ECEF]">
                <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium">
                  Parcelas e vencimentos
                </span>
              </div>
              <div className="divide-y divide-[#E8ECEF]">
                {installmentPreview.map((inst) => (
                  <div key={inst.number} className="flex items-center gap-3 px-3 py-2">
                    <span className="text-sm text-mid w-20 shrink-0">
                      {inst.number}ª parcela
                    </span>
                    <DatePicker
                      value={inst.dueDate}
                      onChange={(v) => {
                        setCustomDueDates((prev) => ({
                          ...prev,
                          [inst.number - 1]: v,
                        }))
                      }}
                      className="w-[140px]"
                    />
                    <span className="font-medium text-charcoal tabular-nums ml-auto">
                      {formatCurrency(inst.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Final amount */}
          <div className="rounded-lg border border-sage/20 bg-[#F0F7F1]/50 p-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-charcoal">Valor da nova cobrança</span>
              <span className="text-lg font-semibold text-forest tabular-nums">
                {formatCurrency(finalTotal)}
              </span>
            </div>
            {waiveAmount > 0 && (
              <p className="text-xs text-mid mt-1">
                Encargos dispensados: {formatCurrency(waiveAmount)}
              </p>
            )}
            {customTotal > 0 && customTotal !== calculatedTotal && (
              <p className="text-xs text-mid mt-1">
                Valor original: {formatCurrency(calculatedTotal)} → Novo: {formatCurrency(customTotal)}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button
            variant="outline"
            className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            className="bg-forest text-cream hover:bg-sage transition-colors"
            onClick={handleConfirm}
            disabled={isPending || finalTotal <= 0 || !description}
          >
            {isPending ? 'Processando...' : 'Confirmar Renegociação'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
