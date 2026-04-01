'use client'

import { useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBulkPay, useBulkCancel } from '@/hooks/mutations/use-financial-mutations'
import { cn } from '@/lib/utils'
import { CheckCircleIcon, XCircleIcon, RefreshCwIcon } from 'lucide-react'
import type { PaymentMethod } from '@/types'

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartao de Credito',
  debit_card: 'Cartao de Debito',
  cash: 'Dinheiro',
  transfer: 'Transferencia',
}

interface BulkActionBarProps {
  selectedCount: number
  selectedInstallmentIds: string[]
  selectedEntryIds: string[]
  onClear: () => void
  onRenegotiate: () => void
  onSuccess?: () => void
}

export function BulkActionBar({
  selectedCount,
  selectedInstallmentIds,
  selectedEntryIds,
  onClear,
  onRenegotiate,
  onSuccess,
}: BulkActionBarProps) {
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paidAt, setPaidAt] = useState('')
  const [cancelReason, setCancelReason] = useState('')

  const bulkPay = useBulkPay()
  const bulkCancel = useBulkCancel()

  async function handleBulkPay() {
    try {
      await bulkPay.mutateAsync({
        installmentIds: selectedInstallmentIds,
        paymentMethod,
        paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
      })
      setPayDialogOpen(false)
      onClear()
      onSuccess?.()
    } catch {
      // error handled by mutation
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
    } catch {
      // error handled by mutation
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
            className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
            onClick={onRenegotiate}
            disabled={selectedEntryIds.length === 0}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Renegociar ({selectedEntryIds.length})
          </Button>
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
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Metodo de Pagamento</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod((v ?? 'pix') as PaymentMethod)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Data do pagamento (opcional)</Label>
              <Input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors" onClick={() => setPayDialogOpen(false)}>
              Cancelar
            </Button>
            <Button className="bg-forest text-cream hover:bg-sage transition-colors" onClick={handleBulkPay} disabled={bulkPay.isPending}>
              {bulkPay.isPending ? 'Processando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-charcoal">Cancelar Cobrancas</DialogTitle>
            <DialogDescription className="text-mid">
              Cancelar {selectedEntryIds.length} cobranca(s). Esta acao nao pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label className="uppercase tracking-wider text-xs font-medium text-mid">Motivo do cancelamento</Label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Informe o motivo..."
                rows={3}
                data-testid="cancel-reason"
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors" onClick={() => setCancelDialogOpen(false)}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={handleBulkCancel} disabled={bulkCancel.isPending || !cancelReason.trim()}>
              {bulkCancel.isPending ? 'Cancelando...' : 'Confirmar Cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
