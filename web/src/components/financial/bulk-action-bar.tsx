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
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBulkPay, useBulkCancel, useBulkUncancel } from '@/hooks/mutations/use-financial-mutations'
import { cn } from '@/lib/utils'
import { ReasonDialog } from './reason-dialog'
import { PAYMENT_METHOD_ITEMS } from '@/lib/financial/constants'
import { toPaidAtIso } from '@/lib/dates'
import { CheckCircleIcon, XCircleIcon, RefreshCwIcon, Undo2Icon } from 'lucide-react'
import type { PaymentMethod } from '@/types'

interface BulkActionBarProps {
  selectedCount: number
  selectedInstallmentIds: string[]
  selectedEntryIds: string[]
  canRenegotiate?: boolean
  canUncancel?: boolean
  onClear: () => void
  onRenegotiate: () => void
  onSuccess?: () => void
}

export function BulkActionBar({
  selectedCount,
  selectedInstallmentIds,
  selectedEntryIds,
  canRenegotiate = true,
  canUncancel = false,
  onClear,
  onRenegotiate,
  onSuccess,
}: BulkActionBarProps) {
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [uncancelDialogOpen, setUncancelDialogOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paidAt, setPaidAt] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [uncancelReason, setUncancelReason] = useState('')

  const bulkPay = useBulkPay()
  const bulkCancel = useBulkCancel()
  const bulkUncancel = useBulkUncancel()

  async function handleBulkPay() {
    try {
      await bulkPay.mutateAsync({
        installmentIds: selectedInstallmentIds,
        paymentMethod,
        paidAt: toPaidAtIso(paidAt),
      })
      setPayDialogOpen(false)
      onClear()
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao processar')
    }
  }

  async function handleBulkCancel() {
    if (!cancelReason.trim()) return
    try {
      await bulkCancel.mutateAsync({
        entryIds: selectedEntryIds,
        reason: cancelReason,
      })
      setCancelDialogOpen(false)
      setCancelReason('')
      onClear()
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao processar')
    }
  }

  async function handleBulkUncancel() {
    if (!uncancelReason.trim()) return
    try {
      await bulkUncancel.mutateAsync({
        entryIds: selectedEntryIds,
        reason: uncancelReason,
      })
      setUncancelDialogOpen(false)
      setUncancelReason('')
      onClear()
      onSuccess?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao processar')
    }
  }

  if (selectedCount === 0) return null

  return (
    <>
      <div
        data-testid="bulk-action-bar"
        className={cn(
          'fixed bottom-0 left-0 right-0 z-40 ml-0 md:ml-64',
          'border-t border-sage/20 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.08)]',
          'flex items-center justify-between gap-3 px-6 py-3',
          'animate-in slide-in-from-bottom duration-200',
        )}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-charcoal">
            {selectedCount} {selectedCount === 1 ? 'selecionado' : 'selecionados'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-mid hover:text-charcoal"
            onClick={onClear}
          >
            Limpar
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="bg-forest text-cream hover:bg-sage transition-colors"
            onClick={() => setPayDialogOpen(true)}
            disabled={selectedInstallmentIds.length === 0}
          >
            <CheckCircleIcon data-icon="inline-start" />
            Marcar como pago ({selectedInstallmentIds.length})
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setCancelDialogOpen(true)}
            disabled={selectedEntryIds.length === 0}
          >
            <XCircleIcon data-icon="inline-start" />
            Cancelar ({selectedEntryIds.length})
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-sage/30 text-charcoal hover:bg-confirmed-bg transition-colors"
            onClick={onRenegotiate}
            disabled={!canRenegotiate}
            title={!canRenegotiate && selectedEntryIds.length > 0 ? 'Selecione cobranças do mesmo paciente' : undefined}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Renegociar ({selectedEntryIds.length})
          </Button>
          {canUncancel && (
            <Button
              size="sm"
              variant="outline"
              className="border-sage/30 text-charcoal hover:bg-confirmed-bg transition-colors"
              onClick={() => setUncancelDialogOpen(true)}
            >
              <Undo2Icon data-icon="inline-start" />
              Reativar ({selectedEntryIds.length})
            </Button>
          )}
        </div>
      </div>

      {/* Bulk Pay Dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-charcoal">Pagamento em Lote</DialogTitle>
            <DialogDescription className="text-mid">
              Registrar pagamento para {selectedInstallmentIds.length} parcela(s).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Data do pagamento (opcional)</Label>
              <DatePicker
                value={paidAt}
                onChange={(v) => setPaidAt(v)}
                className="w-full"
                data-testid="bulk-pay-date"
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="border-sage/30 text-charcoal hover:bg-confirmed-bg transition-colors" onClick={() => setPayDialogOpen(false)}>
              Cancelar
            </Button>
            <Button className="bg-forest text-cream hover:bg-sage transition-colors" onClick={handleBulkPay} disabled={bulkPay.isPending}>
              {bulkPay.isPending ? 'Processando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="Cancelar Cobranças"
        description={`Cancelar ${selectedEntryIds.length} cobrança(s). Cobranças canceladas podem ser reativadas depois, exceto as que vieram de uma renegociação.`}
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
        open={uncancelDialogOpen}
        onOpenChange={setUncancelDialogOpen}
        title="Reativar Cobranças"
        description={`Reativar ${selectedEntryIds.length} cobrança(s).`}
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
