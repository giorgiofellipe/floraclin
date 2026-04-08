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
import { Textarea } from '@/components/ui/textarea'
import { MaskedInput } from '@/components/ui/masked-input'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { usePayInstallment } from '@/hooks/mutations/use-financial-mutations'
import { formatCurrency } from '@/lib/utils'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { allocatePayment, type InstallmentState } from '@/lib/financial/penalties'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'
import type { PaymentMethod } from '@/types'

interface PartialPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  installment: {
    id: string
    amount: number
    amountPaid: number
    fineAmount: number
    interestAmount: number
  }
  onSuccess?: () => void
}

export function PartialPaymentDialog({
  open,
  onOpenChange,
  installment,
  onSuccess,
}: PartialPaymentDialogProps) {
  const remainingPrincipal = installment.amount - installment.amountPaid
  const totalDue = remainingPrincipal + installment.fineAmount + installment.interestAmount

  const [amountStr, setAmountStr] = useState(() => maskCurrency(String(Math.round(totalDue * 100))))
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paidAt, setPaidAt] = useState('')
  const [notes, setNotes] = useState('')

  const payInstallment = usePayInstallment()
  const isPending = payInstallment.isPending

  const parsedAmount = amountStr ? parseCurrency(amountStr) : 0

  const allocation = useMemo(() => {
    if (parsedAmount <= 0) return null
    const state: InstallmentState = {
      amount: installment.amount,
      amountPaid: installment.amountPaid,
      fineAmount: installment.fineAmount,
      interestAmount: installment.interestAmount,
    }
    return allocatePayment(state, parsedAmount)
  }, [parsedAmount, installment])

  // Allow small tolerance for rounding differences between client and server
  const isOverpayment = parsedAmount > totalDue + 0.02

  async function handleConfirm() {
    if (parsedAmount <= 0 || isOverpayment) return
    try {
      await payInstallment.mutateAsync({
        id: installment.id,
        amount: parsedAmount,
        paymentMethod,
        paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
        notes: notes || undefined,
      })
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao processar')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-charcoal">Registrar Pagamento</DialogTitle>
          <DialogDescription className="text-mid">
            Total pendente: {formatCurrency(totalDue)} (Principal {formatCurrency(remainingPrincipal)}
            {installment.fineAmount > 0 && <> + Multa {formatCurrency(installment.fineAmount)}</>}
            {installment.interestAmount > 0 && <> + Juros {formatCurrency(installment.interestAmount)}</>})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Amount */}
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Valor do pagamento (R$)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-charcoal">
                R$
              </span>
              <MaskedInput
                mask={maskCurrency}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0,00"
                className="pl-10 text-lg font-medium"
                inputMode="numeric"
                data-testid="partial-payment-amount"
              />
            </div>
          </div>

          {isOverpayment && (
              <p className="text-xs text-red-600">
                O valor excede o total pendente de {formatCurrency(totalDue)}.
              </p>
            )}

          {/* Payment method */}
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Método de Pagamento</Label>
            <Select items={PAYMENT_METHOD_ITEMS} value={paymentMethod} onValueChange={(v) => setPaymentMethod((v ?? 'pix') as PaymentMethod)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>

          {/* Backdated payment date */}
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Data do pagamento (opcional)</Label>
            <DatePicker
              value={paidAt}
              onChange={(v) => setPaidAt(v)}
              className="w-full"
              data-testid="partial-payment-date"
            />
            <p className="text-xs text-mid">Deixe em branco para usar a data atual.</p>
          </div>

          {/* Art. 354 allocation preview */}
          {allocation && parsedAmount > 0 && (
            <div className="rounded-[3px] border border-sage/20 bg-[#F0F7F1]/50 p-3 space-y-2" data-testid="allocation-preview">
              <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-[#7A7A7A]">
                Prévia da alocação (Art. 354 CC)
              </p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-mid">Juros</span>
                  <span className="font-medium text-charcoal tabular-nums">{formatCurrency(allocation.interestCovered)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-mid">Multa</span>
                  <span className="font-medium text-charcoal tabular-nums">{formatCurrency(allocation.fineCovered)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-mid">Principal</span>
                  <span className="font-medium text-charcoal tabular-nums">{formatCurrency(allocation.principalCovered)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label className="uppercase tracking-wider text-xs font-medium text-mid">Observações</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações opcionais..."
              rows={2}
            />
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
            disabled={isPending || parsedAmount <= 0 || isOverpayment}
          >
            {isPending ? 'Salvando...' : 'Confirmar Pagamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
