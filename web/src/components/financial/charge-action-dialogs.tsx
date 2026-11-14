'use client'

import { useEffect, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, useBulkPay, useBulkCancel, useBulkUncancel } from '@/hooks/mutations/use-financial-mutations'
import { queryKeys } from '@/hooks/queries/query-keys'
import { ReasonDialog } from './reason-dialog'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'
import { brToday, toPaidAtIso } from '@/lib/dates'
import { useInstallmentQuote } from '@/hooks/queries/use-installment-quote'
import { CardPaymentFields, toCardPayload, type CardPaymentValue } from './card-payment-fields'
import { AccountSelect } from './account-select'
import { isCardMethod } from '@/lib/financial/card-repasses'
import { useNfsePrompt } from '@/components/nfse/nfse-prompt-provider'
import { formatCurrency } from '@/lib/utils'
import type { PaymentMethod } from '@/types'

/** The charge actions that open a dialog, shared by the bulk bar and the row. */
export type ChargeDialog = 'pay' | 'cancel' | 'uncancel'

/** Who pays and how they planned to, when one charge is being received. */
export interface ChargePayee {
  patientName: string
  paymentMethod?: string | null
  detail?: string
}

function plannedMethod(method: string | null | undefined): PaymentMethod {
  return method && Object.hasOwn(PAYMENT_METHOD_ITEMS, method) ? (method as PaymentMethod) : 'pix'
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

function QuoteProbe({
  id,
  paidAt,
  onTotal,
}: {
  id: string
  paidAt?: string
  onTotal: (id: string, state: number | 'error' | null) => void
}) {
  const { data, error } = useInstallmentQuote(id, paidAt)
  const state = error ? 'error' : (data?.totalDue ?? null)
  useEffect(() => {
    onTotal(id, state)
  }, [id, state, onTotal])
  return null
}

/**
 * Pay, cancel and reactivate dialogs for one or many charges: the bulk bar
 * passes the selection, a row its own charge with a payee. The server keeps
 * each action's rules and roles either way.
 */
export function ChargeActionDialogs({
  dialog,
  onDialogChange,
  installmentIds,
  entryIds,
  payee,
  onSuccess,
}: {
  dialog: ChargeDialog | null
  onDialogChange: (dialog: ChargeDialog | null) => void
  installmentIds: string[]
  entryIds: string[]
  payee?: ChargePayee
  onSuccess?: () => void
}) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(() => plannedMethod(payee?.paymentMethod))
  const [paidAt, setPaidAt] = useState(brToday)
  const [card, setCard] = useState<CardPaymentValue>({ terminalId: null, installmentCount: 1, expectedRate: null })
  const [accountId, setAccountId] = useState<string | undefined>()
  const [quotes, setQuotes] = useState<Record<string, number | 'error' | null>>({})
  const [cancelReason, setCancelReason] = useState('')
  const [uncancelReason, setUncancelReason] = useState('')
  const { promptAfterPayment } = useNfsePrompt()

  const queryClient = useQueryClient()
  const bulkPay = useBulkPay()
  const bulkCancel = useBulkCancel()
  const bulkUncancel = useBulkUncancel()

  const payOpen = dialog === 'pay'
  const single = entryIds.length === 1

  // Each opening starts from today and the charge's planned method.
  const [wasOpen, setWasOpen] = useState(payOpen)
  if (payOpen !== wasOpen) {
    setWasOpen(payOpen)
    if (payOpen) {
      setPaidAt(brToday())
      setPaymentMethod(plannedMethod(payee?.paymentMethod))
      setAccountId(undefined)
    }
  }

  const cardMethod =
    isCardMethod(paymentMethod) ? paymentMethod : null
  const paidAtIso = toPaidAtIso(paidAt)
  // A row pays one installment, so its amount is quoted for the title; a bulk selection only for a card sale.
  const quoting = payOpen && (payee !== undefined || cardMethod !== null)
  const quoteStates = installmentIds.map((id) => quotes[id] ?? null)
  const quoteFailed = quoteStates.includes('error')
  const quotesReady = quoteStates.every((q) => typeof q === 'number')
  const amountDue = quotesReady
    ? Math.round(quoteStates.reduce<number>((sum, q) => sum + (q as number) * 100, 0)) / 100
    : null
  const amountText = amountDue !== null ? `${formatCurrency(amountDue)} ` : ''
  const title = payee
    ? `Receber ${amountText}de ${payee.patientName}`
    : `Receber ${plural(installmentIds.length, 'parcela', 'parcelas')}`
  const description = payee
    ? payee.detail
    : `${plural(entryIds.length, 'cobrança selecionada', 'cobranças selecionadas')}.`

  function handleQuote(id: string, state: number | 'error' | null) {
    setQuotes((prev) => (prev[id] === state ? prev : { ...prev, [id]: state }))
  }

  // The next pay dialog starts without a terminal.
  const close = () => {
    setCard({ terminalId: null, installmentCount: 1, expectedRate: null })
    onDialogChange(null)
  }

  async function handleBulkPay() {
    try {
      const result = await bulkPay.mutateAsync({
        installmentIds,
        paymentMethod,
        paidAt: paidAtIso,
        expectedTotals: quoting && quotesReady
          ? Object.fromEntries(installmentIds.map((id) => [id, quotes[id] as number]))
          : undefined,
        card: toCardPayload(paymentMethod, card),
        accountId: cardMethod ? undefined : accountId,
      })
      close()
      toast.success(amountDue !== null ? `Pagamento de ${formatCurrency(amountDue)} registrado` : 'Pagamento registrado')
      onSuccess?.()
      promptAfterPayment(result?.nfse)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CARD_RATE_CHANGED') {
        queryClient.invalidateQueries({ queryKey: queryKeys.financial.cardTerminals })
      }
      if (err instanceof ApiError && err.code === 'QUOTE_CHANGED') {
        queryClient.invalidateQueries({ queryKey: ['financial', 'installmentQuote'] })
      }
      toast.error(err instanceof Error ? err.message : 'Erro ao processar')
    }
  }

  async function handleBulkCancel() {
    if (!cancelReason.trim()) return
    try {
      await bulkCancel.mutateAsync({
        entryIds,
        reason: cancelReason,
      })
      close()
      setCancelReason('')
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao processar')
    }
  }

  async function handleBulkUncancel() {
    if (!uncancelReason.trim()) return
    try {
      await bulkUncancel.mutateAsync({
        entryIds,
        reason: uncancelReason,
      })
      close()
      setUncancelReason('')
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao processar')
    }
  }

  return (
    <>
      <Dialog open={payOpen} onOpenChange={(open) => (open ? onDialogChange('pay') : close())}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-charcoal" data-testid="pay-dialog-title">
              {title}
            </DialogTitle>
            {description && <DialogDescription className="text-mid">{description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-4 py-2">
            {quoting &&
              installmentIds.map((id) => <QuoteProbe key={id} id={id} paidAt={paidAtIso} onTotal={handleQuote} />)}
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Método de Pagamento</Label>
              <Select items={PAYMENT_METHOD_ITEMS} value={paymentMethod} onValueChange={(v) => setPaymentMethod((v ?? 'pix') as PaymentMethod)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Data do pagamento</Label>
              <DatePicker
                value={paidAt}
                onChange={(v) => setPaidAt(v)}
                className="w-full"
                data-testid="bulk-pay-date"
              />
            </div>
            {cardMethod && payOpen && (
              <>
                {amountDue !== null ? (
                  <CardPaymentFields
                    method={cardMethod}
                    gross={amountDue}
                    paymentYmd={paidAt || brToday()}
                    value={card}
                    onChange={setCard}
                  />
                ) : (
                  <p className="text-sm text-mid">
                    {quoteFailed ? 'Total pendente indisponível' : 'Calculando...'}
                  </p>
                )}
              </>
            )}
            {!cardMethod && payOpen && (
              <AccountSelect value={accountId} onChange={setAccountId} method={paymentMethod} />
            )}
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="border-sage/30 text-charcoal hover:bg-confirmed-bg transition-colors" onClick={close}>
              Cancelar
            </Button>
            <Button className="bg-forest text-cream hover:bg-sage transition-colors" onClick={handleBulkPay}
              disabled={bulkPay.isPending || (quoting && !quotesReady) || (cardMethod !== null && card.terminalId === null)}
              data-testid="pay-confirm"
            >
              {bulkPay.isPending ? 'Processando...' : 'Confirmar recebimento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(open) => onDialogChange(open ? 'cancel' : null)}
        title={single ? 'Cancelar cobrança' : 'Cancelar Cobranças'}
        description={`Cancelar ${entryIds.length} cobrança(s). Cobranças canceladas podem ser reativadas depois, exceto as que vieram de uma renegociação.`}
        reasonLabel="Motivo do cancelamento"
        reason={cancelReason}
        onReasonChange={setCancelReason}
        reasonTestId="cancel-reason"
        confirmLabel="Confirmar Cancelamento"
        pendingLabel="Cancelando..."
        isPending={bulkCancel.isPending}
        destructive
        onConfirm={handleBulkCancel}
      />

      <ReasonDialog
        open={dialog === 'uncancel'}
        onOpenChange={(open) => onDialogChange(open ? 'uncancel' : null)}
        title={single ? 'Reativar cobrança' : 'Reativar Cobranças'}
        description={`Reativar ${entryIds.length} cobrança(s).`}
        reasonLabel="Motivo da reativação"
        reason={uncancelReason}
        onReasonChange={setUncancelReason}
        reasonTestId="uncancel-reason"
        confirmLabel="Confirmar Reativação"
        pendingLabel="Reativando..."
        isPending={bulkUncancel.isPending}
        onConfirm={handleBulkUncancel}
      />
    </>
  )
}
