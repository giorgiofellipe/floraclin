'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCancelNfse } from '@/hooks/queries/use-nfse-documents'
import { NFSE_CANCEL_JUSTIFICATION_MAX, NFSE_CANCEL_JUSTIFICATION_MIN } from '@/lib/nfse/config'
import type { NfseCancelReason } from '@/lib/nfse/types'

const REASONS: { value: NfseCancelReason; label: string }[] = [
  { value: 1, label: 'Erro na emissão' },
  { value: 2, label: 'Serviço não prestado' },
  { value: 9, label: 'Outros' },
]

const REASON_ITEMS = Object.fromEntries(REASONS.map(({ value, label }) => [String(value), label]))

interface CancelNfseDialogProps {
  documentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function CancelNfseForm({ documentId, onOpenChange }: Omit<CancelNfseDialogProps, 'open'>) {
  const cancel = useCancelNfse()
  const [reason, setReason] = useState<NfseCancelReason>(1)
  const [justification, setJustification] = useState('')
  const length = justification.trim().length
  const valid = length >= NFSE_CANCEL_JUSTIFICATION_MIN && length <= NFSE_CANCEL_JUSTIFICATION_MAX

  async function handleConfirm() {
    try {
      const result = await cancel.mutateAsync({
        documentId,
        reason,
        justification: justification.trim(),
      })
      if (result.errorMessage) toast.error(result.errorMessage)
      else toast.success(result.status === 'cancelled' ? 'NFS-e cancelada' : 'Cancelamento solicitado')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cancelar a NFS-e')
    }
  }

  return (
    <>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider font-medium text-mid">Motivo</Label>
          <Select items={REASON_ITEMS} value={String(reason)}
            onValueChange={(v) => setReason(REASONS.find((r) => String(r.value) === v)?.value ?? 1)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider font-medium text-mid">Justificativa</Label>
          <Textarea
            rows={3}
            maxLength={NFSE_CANCEL_JUSTIFICATION_MAX}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
          <p className="text-[10px] text-mid tabular-nums">{length}/{NFSE_CANCEL_JUSTIFICATION_MAX} (mínimo {NFSE_CANCEL_JUSTIFICATION_MIN})</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Voltar
        </Button>
        <Button variant="destructive" disabled={!valid || cancel.isPending} onClick={handleConfirm}>
          {cancel.isPending && <Loader2Icon className="size-4 animate-spin" />}
          Cancelar NFS-e
        </Button>
      </DialogFooter>
    </>
  )
}

export function CancelNfseDialog({ documentId, open, onOpenChange }: CancelNfseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar NFS-e</DialogTitle>
          <DialogDescription>
            O cancelamento é registrado na Receita e não pode ser desfeito. O pagamento continua registrado.
          </DialogDescription>
        </DialogHeader>
        {open && <CancelNfseForm documentId={documentId} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  )
}
