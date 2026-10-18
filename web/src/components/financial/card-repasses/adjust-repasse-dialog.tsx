'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { brToday } from '@/lib/dates'
import { useAdjustCardRepasse } from '@/hooks/queries/use-card-repasses'
import type { CardRepasseListRow } from '@/db/queries/card-payments'

interface AdjustRepasseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repasse: CardRepasseListRow
}

export function AdjustRepasseDialog({ open, onOpenChange, repasse }: AdjustRepasseDialogProps) {
  const [netAmount, setNetAmount] = useState(repasse.netAmount)
  const [expectedDate, setExpectedDate] = useState(repasse.expectedDate)
  const adjust = useAdjustCardRepasse()

  const amount = Number(netAmount)
  const netExceedsGross = amount > Number(repasse.grossAmount)
  const canSubmit = Number.isFinite(amount) && amount > 0 && !netExceedsGross && expectedDate !== ''

  const handleSubmit = async () => {
    try {
      await adjust.mutateAsync({ id: repasse.id, netAmount: amount, expectedDate })
      toast.success('Repasse ajustado')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao ajustar repasse')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-charcoal">Ajustar repasse</DialogTitle>
          <DialogDescription className="text-mid">{repasse.patientName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="repasse-net-amount" className="uppercase tracking-wider text-xs font-medium text-mid">
              Valor líquido (R$)
            </Label>
            <Input
              id="repasse-net-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={netAmount}
              onChange={(e) => setNetAmount(e.target.value)}
            />
            {netExceedsGross && (
              <p className="text-xs text-red-600">O valor líquido não pode ser maior que o bruto.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Data prevista</Label>
            <DatePicker
              value={expectedDate}
              onChange={setExpectedDate}
              maxDate={repasse.status === 'received' ? brToday() : undefined}
            />
          </div>
          {repasse.status === 'received' && (
            <p className="text-sm text-mid">
              O lançamento anterior no extrato será estornado e um novo será criado.
            </p>
          )}
        </div>
        <DialogFooter className="pt-2">
          <Button variant="outline" className="border-sage/30 text-charcoal" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            className="bg-forest text-cream hover:bg-sage transition-colors"
            onClick={handleSubmit}
            disabled={adjust.isPending || !canSubmit}
          >
            {adjust.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
