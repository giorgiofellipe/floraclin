'use client'

import { useEffect, useEffectEvent, useMemo, useState } from 'react'
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
import { ApiError, usePayInstallment } from '@/hooks/mutations/use-financial-mutations'
import { useInstallmentQuote } from '@/hooks/queries/use-installment-quote'
import { formatCurrency } from '@/lib/utils'
import { maskCurrency, parseCurrency } from '@/lib/masks'
import { allocatePayment } from '@/lib/financial/penalties'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'
import { toPaidAtIso } from '@/lib/dates'
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

// Nothing the operator can do from this dialog once the installment is no
// longer payable; the list behind it is what needs refreshing.
const TERMINAL_CODES = new Set(['INSTALLMENT_ALREADY_PAID', 'INSTALLMENT_CANCELLED', 'INSTALLMENT_NOT_FOUND'])

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

  const paidAtIso = toPaidAtIso(paidAt)

  const {
    data: quote,
    isFetching: isQuoting,
    error: quoteError,
    refetch: refetchQuote,
  } = useInstallmentQuote(installment.id, paidAtIso, open)

  const quoteErrorCode = quoteError instanceof ApiError ? quoteError.code : undefined
  const backdateRefusal = quoteErrorCode === 'PAYMENT_BEFORE_LATER_PAYMENT' ? quoteError?.message : undefined

  const closeAsSettled = useEffectEvent((message: string) => {
    toast.error(message)
    onOpenChange(false)
    onSuccess?.()
  })

  useEffect(() => {
    if (quoteError && TERMINAL_CODES.has(quoteErrorCode ?? '')) closeAsSettled(quoteError.message)
  }, [quoteError, quoteErrorCode])

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

  const excess = allocation?.excessAmount ?? 0
  const isOverpayment = excess > 0

  // A cached quote for the previous date must not stay on screen while the new
  // one is in flight, and a failed quote must not sit on "Calculando..."
  // forever next to the panel saying it already failed.
  const pendingTotalsLabel = quoteError ? 'Total pendente indisponível' : 'Calculando...'

  async function handleConfirm() {
    if (!quote || parsedAmount <= 0) return
    try {
      await payInstallment.mutateAsync({
        id: installment.id,
        amount: parsedAmount,
        paymentMethod,
        paidAt: paidAtIso,
        notes: notes || undefined,
        expectedTotalDue: quote.totalDue,
        acceptOverpayment: isOverpayment || undefined,
      })
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'QUOTE_CHANGED') {
        // A prefilled amount follows the fresh quote on its own; an amount
        // the user typed is theirs to keep.
        refetchQuote()
      } else if (err instanceof ApiError && TERMINAL_CODES.has(err.code ?? '')) {
        onOpenChange(false)
        onSuccess?.()
      }
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
          {quoteError && !backdateRefusal && (
            <div className="rounded-[3px] border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-xs text-red-600">{quoteError.message}</p>
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
                // A new date means a new price; keeping the edit flag would
                // submit an amount quoted for the previous day.
                setAmountTouched(false)
              }}
              className="w-full"
              data-testid="partial-payment-date"
            />
            {backdateRefusal ? (
              <p className="text-xs text-red-600" data-testid="partial-payment-date-error">
                {backdateRefusal}
              </p>
            ) : (
              <p className="text-xs text-mid">Deixe em branco para usar a data atual.</p>
            )}
          </div>

          {/* Art. 354 allocation preview */}
          {allocation && (
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
                {allocation.excessAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-mid">Excedente</span>
                    <span className="font-medium text-charcoal tabular-nums">{formatCurrency(allocation.excessAmount)}</span>
                  </div>
                )}
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
            disabled={isPending}
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
