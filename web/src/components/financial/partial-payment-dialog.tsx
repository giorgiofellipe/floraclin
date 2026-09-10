'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { useInstallmentQuote } from '@/hooks/queries/use-installment-quote'
import { formatCurrency } from '@/lib/utils'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { allocatePayment } from '@/lib/financial/penalties'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'
import { brToday, parseBrDate } from '@/lib/dates'
import type { PaymentMethod } from '@/types'

interface PartialPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  installment: {
    id: string
    amount: number
  }
  onSuccess?: () => void
}

export function PartialPaymentDialog({
  open,
  onOpenChange,
  installment,
  onSuccess,
}: PartialPaymentDialogProps) {
  const [amountStr, setAmountStr] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paidAt, setPaidAt] = useState('')
  const [notes, setNotes] = useState('')

  // A picked day equal to today is sent as "no date" so the server uses the
  // real instant. BR noon on today is ahead of the wall clock all morning, and
  // the API rejects a future payment date.
  const paidAtIso = useMemo(() => {
    if (!paidAt || paidAt === brToday()) return undefined
    return parseBrDate(paidAt, '12:00:00').toISOString()
  }, [paidAt])

  const {
    data: quote,
    isFetching: isQuoting,
    error: quoteError,
    refetch: refetchQuote,
  } = useInstallmentQuote(installment.id, paidAtIso, open)

  const payInstallment = usePayInstallment()
  const isPending = payInstallment.isPending

  const parsedAmount = amountStr ? parseCurrency(amountStr) : 0

  useEffect(() => {
    if (!quote || amountTouched) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill from quote unless the user has edited the field
    setAmountStr(maskCurrency(String(Math.round(quote.totalDue * 100))))
  }, [quote, amountTouched])

  const allocation = useMemo(() => {
    if (!quote || parsedAmount <= 0) return null
    return allocatePayment(
      {
        amount: installment.amount,
        amountPaid: installment.amount - quote.remainingPrincipal,
        fineAmount: quote.fineAmount,
        interestAmount: quote.interestAmount,
      },
      parsedAmount,
    )
  }, [parsedAmount, quote, installment.amount])

  const isOverpayment = quote != null && parsedAmount > quote.totalDue
  const excess = isOverpayment && quote ? Math.round((parsedAmount - quote.totalDue) * 100) / 100 : 0

  // A cached quote for the previous date must not stay on screen while the new
  // one is in flight, and a failed quote must not sit on "Calculando..."
  // forever next to the panel saying it already failed.
  const pendingTotalsLabel = quoteError ? 'Total pendente indisponível' : 'Calculando...'

  async function handleConfirm() {
    if (parsedAmount <= 0) return
    try {
      await payInstallment.mutateAsync({
        id: installment.id,
        amount: parsedAmount,
        paymentMethod,
        paidAt: paidAtIso,
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
            {quote && !isQuoting ? (
              <>
                Total pendente: {formatCurrency(quote.totalDue)} (Principal{' '}
                {formatCurrency(quote.remainingPrincipal)}
                {quote.fineAmount > 0 && <> + Multa {formatCurrency(quote.fineAmount)}</>}
                {quote.interestAmount > 0 && <> + Juros {formatCurrency(quote.interestAmount)}</>})
              </>
            ) : (
              pendingTotalsLabel
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {quoteError && (
            <div className="rounded-[3px] border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-xs text-red-600">
                {quoteError instanceof Error ? quoteError.message : 'Erro ao calcular o valor da parcela'}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetchQuote()}>
                Tentar novamente
              </Button>
            </div>
          )}

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
                onChange={(e) => {
                  setAmountStr(e.target.value)
                  setAmountTouched(true)
                }}
                placeholder="0,00"
                className="pl-10 text-lg font-medium"
                inputMode="numeric"
                data-testid="partial-payment-amount"
              />
            </div>
          </div>

          {isOverpayment && (
            <p className="text-xs text-amber-700">
              Valor acima do total pendente. O excedente de {formatCurrency(excess)} será
              registrado, mas não gera crédito para próximas cobranças.
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
              onChange={(v) => {
                setPaidAt(v)
                // A new date means a new price. Keeping the edit flag here
                // would suppress the reprice and submit an amount quoted for
                // the previous day, which is the bug this dialog exists to fix.
                setAmountTouched(false)
              }}
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
            disabled={isPending || isQuoting || !quote || !!quoteError || parsedAmount <= 0}
          >
            {isPending ? 'Salvando...' : 'Confirmar Pagamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
