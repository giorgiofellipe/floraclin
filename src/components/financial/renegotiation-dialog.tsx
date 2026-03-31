'use client'

import { useMemo, useState } from 'react'
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
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useRenegotiate } from '@/hooks/mutations/use-financial-mutations'
import { formatCurrency } from '@/lib/utils'
import { maskCurrency, parseCurrency } from '@/lib/masks'

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
    `Renegociacao — ${patientName}`,
  )
  const [installmentCount, setInstallmentCount] = useState('1')
  const [waivePenalties, setWaivePenalties] = useState(false)
  const [waiveAmountStr, setWaiveAmountStr] = useState('')

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

  const consolidatedTotal = totals.total - waiveAmount

  async function handleConfirm() {
    if (consolidatedTotal <= 0) return
    try {
      await renegotiate.mutateAsync({
        entryIds: entries.map((e) => e.id),
        newInstallmentCount: parseInt(installmentCount, 10) || 1,
        description,
        waivePenalties,
        waiveAmount,
      })
      onOpenChange(false)
      onSuccess?.()
    } catch {
      // error handled by mutation
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-charcoal">Renegociacao</DialogTitle>
          <DialogDescription className="text-mid">
            Consolide as cobrancas selecionadas em uma nova cobranca.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
          {/* Summary table */}
          <div className="rounded-[3px] border border-[#E8ECEF] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-white border-b border-[#E8ECEF] hover:bg-white">
                  <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A]">Descricao</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] text-right">Principal</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] text-right">Encargos</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id} className="border-b border-[#E8ECEF]">
                    <TableCell className="text-charcoal text-sm">{entry.description}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{formatCurrency(entry.remainingPrincipal)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-amber-700">
                      {formatCurrency(entry.fineAmount + entry.interestAmount)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-sm">
                      {formatCurrency(entry.remainingPrincipal + entry.fineAmount + entry.interestAmount)}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals row */}
                <TableRow className="bg-[#F4F6F8] hover:bg-[#F4F6F8]">
                  <TableCell className="font-medium text-charcoal">Total</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatCurrency(totals.principal)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-amber-700">{formatCurrency(totals.penalties)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatCurrency(totals.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Waive penalties */}
          {totals.penalties > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Switch
                  checked={waivePenalties}
                  onCheckedChange={setWaivePenalties}
                  data-testid="waive-toggle"
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
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Descricao da nova cobranca</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Renegociacao — Paciente"
              data-testid="renegotiation-description"
            />
          </div>

          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Numero de parcelas</Label>
            <Select value={installmentCount} onValueChange={(v) => setInstallmentCount(v ?? '1')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1}x
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Final amount */}
          <div className="rounded-[3px] border border-sage/20 bg-[#F0F7F1]/50 p-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-charcoal">Valor da nova cobranca</span>
              <span className="text-lg font-semibold text-forest tabular-nums" data-testid="consolidated-total">
                {formatCurrency(consolidatedTotal)}
              </span>
            </div>
            {waiveAmount > 0 && (
              <p className="text-xs text-mid mt-1">
                Encargos dispensados: {formatCurrency(waiveAmount)}
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
            disabled={isPending || consolidatedTotal <= 0 || !description}
          >
            {isPending ? 'Processando...' : 'Confirmar Renegociacao'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
